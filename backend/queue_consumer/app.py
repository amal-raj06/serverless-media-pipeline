import os
import json
import boto3

sfn_client = boto3.client("stepfunctions")
STATE_MACHINE_ARN = os.environ.get("STATE_MACHINE_ARN")

def lambda_handler(event, context):
    for record in event.get("Records", []):
        body = json.loads(record.get("body", "{}"))
        
        # Trigger Step Functions State Machine execution per queued file event
        sfn_client.start_execution(
            stateMachineArn=STATE_MACHINE_ARN,
            input=json.dumps(body)
        )
        
    return {
        "statusCode": 200,
        "body": json.dumps({"processed_records": len(event.get("Records", []))})
    }