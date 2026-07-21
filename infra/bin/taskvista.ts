#!/usr/bin/env node
/**
 * TaskVista CDK エントリポイント
 *
 * 例:
 *   npx cdk deploy --all -c env=dev
 *   npx cdk deploy --all -c env=prod
 *   npx cdk synth -c env=dev
 */
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { TaskVistaStack } from '../lib/taskvista-stack'
import { getEnvironmentConfig } from '../lib/config'

const app = new cdk.App()

const envName = String(app.node.tryGetContext('env') ?? 'dev')
const config = getEnvironmentConfig(envName)

const awsEnv: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? config.region,
}

new TaskVistaStack(app, `TaskVista-${config.envName}`, {
  env: awsEnv,
  config,
  description: `TaskVista full stack (${config.envName}) — Auth / Storage / Backend / Frontend`,
  tags: config.tags,
})

app.synth()
