import { NextResponse } from 'next/server';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const ddbClient = new DynamoDBClient({ region: 'ap-south-1' });
const sqsClient = new SQSClient({ region: 'ap-south-1' });

const SQS_QUEUE_URL =
  process.env.SQS_QUEUE_URL ||
  'https://sqs.ap-south-1.amazonaws.com/777772816164/media-processing-queue';

export async function POST(request: Request) {
  try {
    const { fileId } = await request.json();

    if (!fileId) {
      return NextResponse.json(
        { error: 'Missing fileId parameter.' },
        { status: 400 }
      );
    }

    // 1. Reset status in DynamoDB from QUARANTINED to PENDING
    const updateCommand = new UpdateItemCommand({
      TableName: 'MediaProcessingRegistry',
      Key: { FileId: { S: fileId } },
      UpdateExpression: 'SET #st = :pending REMOVE ErrorMessage',
      ExpressionAttributeNames: { '#st': 'Status' },
      ExpressionAttributeValues: { ':pending': { S: 'PENDING' } },
    });
    await ddbClient.send(updateCommand);

    // 2. Re-inject EventBridge S3 ObjectCreated event message into the main SQS queue
    const sqsPayload = {
      source: 'aws.s3',
      detail: {
        bucket: { name: 'media-ingestion-raw-777772816164-ap-south-1' },
        object: { key: fileId },
      },
    };

    const sendMsgCommand = new SendMessageCommand({
      QueueUrl: SQS_QUEUE_URL,
      MessageBody: JSON.stringify(sqsPayload),
    });
    await sqsClient.send(sendMsgCommand);

    return NextResponse.json({
      message: `Successfully re-queued '${fileId}' for processing.`,
      fileId,
    });
  } catch (error: any) {
    console.error('Redrive Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}