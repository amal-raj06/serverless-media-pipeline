import json
import os
import urllib.parse
import boto3
from botocore.config import Config

boto_config = Config(
    connect_timeout=5,
    read_timeout=10,
    retries={'max_attempts': 2}
)

dynamodb = boto3.resource('dynamodb', region_name='ap-south-1', config=boto_config)
TABLE_NAME = os.environ.get('TABLE_NAME', 'MediaProcessingRegistry')

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,POST',
    'Content-Type': 'application/json'
}

def lambda_handler(event, context):
    http_method = event.get('httpMethod') or event.get('requestContext', {}).get('http', {}).get('method', '')

    # Handle CORS Preflight OPTIONS Request
    if http_method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps({'message': 'CORS preflight successful'})
        }

    try:
        table = dynamodb.Table(TABLE_NAME)
        path_parameters = event.get('pathParameters') or {}
        file_id = path_parameters.get('fileId')

        if file_id:
            # Single item lookup
            decoded_file_id = urllib.parse.unquote(file_id)
            response = table.get_item(Key={'FileId': decoded_file_id})
            item = response.get('Item')

            if not item:
                return {
                    'statusCode': 404,
                    'headers': CORS_HEADERS,
                    'body': json.dumps({'error': f"Record with FileId '{decoded_file_id}' not found."})
                }

            return {
                'statusCode': 200,
                'headers': CORS_HEADERS,
                'body': json.dumps(item)
            }

        # Full table scan for registry UI
        response = table.scan()
        items = response.get('Items', [])

        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
            'body': json.dumps(items)
        }

    except Exception as e:
        print(f"API Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': 'Internal server error', 'details': str(e)})
        }