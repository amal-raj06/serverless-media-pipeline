import { NextResponse } from 'next/server';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const ddbClient = new DynamoDBClient({ region: 'ap-south-1' });
const s3Client = new S3Client({ region: 'ap-south-1' });

export async function GET() {
  try {
    const command = new ScanCommand({
      TableName: 'MediaProcessingRegistry',
    });

    const response = await ddbClient.send(command);
    const rawItems = response.Items ? response.Items.map((item) => unmarshall(item)) : [];

    const items = await Promise.all(
      rawItems.map(async (item: any) => {
        if (item.ThumbnailKey && item.SourceBucket) {
          try {
            const getObjCmd = new GetObjectCommand({
              Bucket: item.SourceBucket,
              Key: item.ThumbnailKey,
            });
            item.ThumbnailUrl = await getSignedUrl(s3Client, getObjCmd, { expiresIn: 3600 });
          } catch (e) {
            console.error('Presigned URL error:', e);
          }
        }
        return item;
      })
    );

    return NextResponse.json(items, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error: any) {
    console.error('DynamoDB Scan Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}