import os
import io
import json
import hashlib
import urllib.parse
import boto3
from botocore.config import Config
from PIL import Image, ImageOps
from PIL.ExifTags import TAGS, GPSTAGS
from pypdf import PdfReader

# Explicit boto3 network configuration to prevent hangs
boto_config = Config(
    connect_timeout=5,
    read_timeout=10,
    retries={'max_attempts': 2}
)

s3_client = boto3.client('s3', region_name='ap-south-1', config=boto_config)
dynamodb = boto3.resource('dynamodb', region_name='ap-south-1', config=boto_config)
sns_client = boto3.client('sns', region_name='ap-south-1', config=boto_config)

RAW_BUCKET = os.environ.get('RAW_BUCKET', 'media-ingestion-raw-777772816164-ap-south-1')
TABLE_NAME = os.environ.get('TABLE_NAME', 'MediaProcessingRegistry')
SNS_TOPIC_ARN = os.environ.get('SNS_TOPIC_ARN', 'arn:aws:sns:ap-south-1:777772816164:MediaProcessingAlerts')

MAGIC_BYTES = {
    'jpg': [b'\xFF\xD8\xFF'],
    'png': [b'\x89\x50\x4E\x47\x0D\x0A\x1A\x0A'],
    'webp': [b'RIFF'],
    'pdf': [b'%PDF']
}

def lambda_handler(event, context):
    table = dynamodb.Table(TABLE_NAME)
    print(f"Incoming Event: {json.dumps(event)}")
    
    for record in event.get('Records', []):
        # Normalize body across direct SQS messages and nested structures
        body = json.loads(record['body']) if isinstance(record.get('body'), str) else record.get('body', record)
        
        # 1. Handling EventBridge S3 Events (aws.s3)
        if isinstance(body, dict) and body.get('source') == 'aws.s3':
            detail = body.get('detail', {})
            bucket_name = detail.get('bucket', {}).get('name', RAW_BUCKET)
            raw_key = detail.get('object', {}).get('key', '')
            
            object_key = urllib.parse.unquote_plus(raw_key)
            
            # Guard clause against recursive invocation
            if object_key.startswith('transcoded/') or object_key.lower().endswith('.webp'):
                print(f"Skipping already processed key: {object_key}")
                continue
                
            process_media_pipeline(bucket_name, object_key, table)
            
        # 2. Handling Direct S3 Event Notifications (Standard S3 -> SQS schema)
        elif isinstance(body, dict) and 'Records' in body:
            for s3_rec in body['Records']:
                bucket_name = s3_rec['s3']['bucket']['name']
                raw_key = s3_rec['s3']['object']['key']
                
                object_key = urllib.parse.unquote_plus(raw_key)
                
                # Guard clause against recursive invocation
                if object_key.startswith('transcoded/') or object_key.lower().endswith('.webp'):
                    print(f"Skipping already processed key: {object_key}")
                    continue
                    
                process_media_pipeline(bucket_name, object_key, table)

    return {"statusCode": 200, "body": json.dumps("Processing Complete")}

def process_media_pipeline(bucket_name, object_key, table):
    try:
        print(f"Fetching S3 Object: Bucket={bucket_name}, Key={object_key}")
        response = s3_client.get_object(Bucket=bucket_name, Key=object_key)
        file_bytes = response['Body'].read()
        file_size = len(file_bytes)

        if file_size == 0:
            raise ValueError("Poison Pill: File is 0 bytes.")
            
        sha256_hash = hashlib.sha256(file_bytes).hexdigest()
        detected_format = validate_magic_bytes(file_bytes)
        print(f"Validated {object_key} | Hash: {sha256_hash} | Format: {detected_format}")

        metadata = {
            'FileId': object_key,
            'SourceBucket': bucket_name,
            'SizeBytes': file_size,
            'SHA256': sha256_hash,
            'Format': detected_format,
            'Status': 'PROCESSED'
        }

        if detected_format in ['jpg', 'png', 'webp']:
            img = Image.open(io.BytesIO(file_bytes))
            clean_img = ImageOps.exif_transpose(img).convert('RGB')
            
            webp_buffer = io.BytesIO()
            clean_img.save(webp_buffer, format='WEBP', quality=80)
            
            transcoded_key = f"transcoded/{os.path.basename(object_key)}.webp"
            s3_client.put_object(
                Bucket=bucket_name,
                Key=transcoded_key,
                Body=webp_buffer.getvalue(),
                ContentType='image/webp'
            )
            print(f"Uploaded transcoded image to {transcoded_key}")

        table.put_item(Item=metadata)
        print(f"Successfully registered {object_key} in DynamoDB")

    except Exception as e:
        print(f"ERROR processing {object_key}: {str(e)}")
        table.put_item(
            Item={
                'FileId': object_key,
                'SourceBucket': bucket_name,
                'SizeBytes': file_size if 'file_size' in locals() else 0,
                'Status': 'QUARANTINED',
                'ErrorMessage': str(e)
            }
        )
        sns_client.publish(
            TopicArn=SNS_TOPIC_ARN,
            Subject="[Pipeline Quarantine] Poison Pill Media File Intercepted",
            Message=f"Quarantined {object_key}. Reason: {str(e)}"
        )

def validate_magic_bytes(file_bytes):
    for fmt, signatures in MAGIC_BYTES.items():
        for sig in signatures:
            if file_bytes.startswith(sig):
                return fmt
    raise ValueError("Magic byte validation failed: Unknown or malicious file signature.")