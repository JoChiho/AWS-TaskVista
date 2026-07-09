import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

const region = 'us-east-1'
const table = 'TaskVista-Projects'
const poolId = 'us-east-1_PvLPf6TL0'
const cognito = new CognitoIdentityProviderClient({ region })
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }))

async function findSubByEmail(email) {
  const normalized = email.trim().toLowerCase()
  const result = await cognito.send(
    new ListUsersCommand({
      UserPoolId: poolId,
      Filter: `email = "${normalized}"`,
      Limit: 5,
    }),
  )
  const user = result.Users?.[0]
  if (!user) return null
  const attrs = Object.fromEntries((user.Attributes || []).map((a) => [a.Name, a.Value]))
  return {
    userId: attrs.sub,
    email: (attrs.email || normalized).toLowerCase(),
    displayName: attrs.name || attrs.preferred_username || normalized.split('@')[0],
  }
}

const scan = await ddb.send(new ScanCommand({ TableName: table }))
const items = (scan.Items || []).filter((p) => !p.isDeleted)
console.log('projects', items.length)

for (const project of items) {
  const emails = new Set((project.memberEmails || []).map((e) => String(e).toLowerCase()))
  const members = [...(project.members || [])]
  for (const m of members) {
    if (m.email) emails.add(String(m.email).toLowerCase())
  }
  const realEmails = [...emails].filter((e) => e.includes('@') && !e.endsWith('@unknown.local'))
  const memberIds = new Set(project.memberIds || [])
  if (project.createdBy) memberIds.add(project.createdBy)

  let changed = false
  for (const email of realEmails) {
    try {
      const found = await findSubByEmail(email)
      if (!found?.userId) {
        console.log(' skip', project.name, email)
        continue
      }
      if (!memberIds.has(found.userId)) {
        memberIds.add(found.userId)
        changed = true
      }
      const idx = members.findIndex((m) => String(m.email).toLowerCase() === email)
      if (idx >= 0) {
        if (members[idx].userId !== found.userId) {
          members[idx] = { ...members[idx], userId: found.userId, email: found.email }
          changed = true
        }
      } else {
        members.push({
          userId: found.userId,
          email: found.email,
          displayName: found.displayName,
        })
        changed = true
      }
      console.log(' found', email, found.userId)
    } catch (e) {
      console.error(' err', email, e.message)
    }
  }

  if (!changed) {
    console.log('OK', project.name, [...memberIds])
    continue
  }

  await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { projectId: project.projectId },
      UpdateExpression:
        'SET memberIds = :ids, memberEmails = :emails, members = :members, updatedAt = :u',
      ExpressionAttributeValues: {
        ':ids': [...memberIds],
        ':emails': [...realEmails],
        ':members': members,
        ':u': new Date().toISOString(),
      },
    }),
  )
  console.log('FIXED', project.name, [...memberIds])
}
