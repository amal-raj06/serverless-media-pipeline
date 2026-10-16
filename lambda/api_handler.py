import os
import json
import boto3
from decimal import Decimal
from botocore.config import Config

# Custom JSON Encoder to convert DynamoDB Decimal types to native int/float
class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            if obj % 1 == 0:
                return int(obj)
            else:
                return float(obj)
        return super(DecimalEncoder, self).default(obj)

boto_config = Config(
    connect_timeout=5,
    read_timeout=10,
    retries={'max_attempts': 2},
    signature_version='s3v4'
)

s3_client = boto3.client('s3', region_name='ap-south-1', config=boto_config)
dynamodb = boto3.resource('dynamodb', region_name='ap-south-1', config=boto_config)

RAW_BUCKET = os.environ.get('RAW_BUCKET', 'media-ingestion-raw-777772816164-ap-south-1')
TABLE_NAME = os.environ.get('TABLE_NAME', 'MediaMetadataTable')

def build_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
        },
        "body": json.dumps(body, cls=DecimalEncoder)
    }

def lambda_handler(event, context):
    print("Media API Event:", json.dumps(event))
    path = event.get('path', '')
    http_method = event.get('httpMethod', '')

    if http_method == 'OPTIONS':
        return build_response(200, {"message": "CORS preflight successful"})

    # 1. GET /media - Scan registry and convert Decimal types cleanly
    if path == '/media' and http_method == 'GET':
        try:
            table = dynamodb.Table(TABLE_NAME)
            response = table.scan()
            items = response.get('Items', [])
            return build_response(200, {"items": items})
        except Exception as e:
            print(f"Error scanning DynamoDB: {e}")
            return build_response(500, {"error": str(e)})

    # 2. POST /upload-url - Generate Pre-Signed S3 Upload URL
    elif path == '/upload-url' and http_method == 'POST':
        try:
            body = json.loads(event.get('body', '{}'))
            file_name = body.get('fileName', '')
            content_type = body.get('contentType', 'application/octet-stream')

            if not file_name:
                return build_response(400, {"error": "fileName parameter is required"})

            upload_url = s3_client.generate_presigned_url(
                'put_object',
                Params={
                    'Bucket': RAW_BUCKET,
                    'Key': file_name,
                    'ContentType': content_type
                },
                ExpiresIn=300
            )

            return build_response(200, {
                "uploadUrl": upload_url,
                "fileKey": file_name,
                "bucket": RAW_BUCKET
            })
        except Exception as e:
            print(f"Error generating upload presigned URL: {e}")
            return build_response(500, {"error": str(e)})

    # 3. POST /download-url - Generate Pre-Signed S3 Download URL
    elif path == '/download-url' and http_method == 'POST':
        try:
            body = json.loads(event.get('body', '{}'))
            file_key = body.get('fileKey', '')

            if not file_key:
                return build_response(400, {"error": "fileKey parameter is required"})

            download_url = s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': RAW_BUCKET,
                    'Key': file_key
                },
                ExpiresIn=300
            )

            return build_response(200, {"downloadUrl": download_url})
        except Exception as e:
            print(f"Error generating download presigned URL: {e}")
            return build_response(500, {"error": str(e)})

    return build_response(404, {"error": "Route not found"})