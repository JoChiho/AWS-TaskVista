/**
 * 環境別設定
 *
 * 使い方:
 *   cdk deploy -c env=dev
 *   cdk deploy -c env=prod
 *
 * アカウント ID は CDK_DEFAULT_ACCOUNT / AWS プロファイルから取得する。
 * 既存手動リソース名（prod）との互換を維持する。
 */

export type EnvironmentName = 'dev' | 'prod';

export interface DomainConfig {
  /** 例: taskvista-navino.net */
  domainName: string
  /** us-east-1 の ACM 証明書 ARN（CloudFront 用。未設定なら default CloudFront ドメインのみ） */
  certificateArn?: string
  /** Hosted Zone ID（Route53 レコードを作る場合） */
  hostedZoneId?: string
}

export interface EnvironmentConfig {
  envName: EnvironmentName
  region: string
  /** 未指定時は CDK のデフォルトアカウント */
  account?: string

  /** リソース名プレフィックス（例: TaskVista-dev） */
  prefix: string

  /**
   * 既存 prod 手動リソースとの互換名。
   * true のときテーブル/バケット名を従来どおり（TaskVista-Projects 等）にする。
   */
  useLegacyResourceNames: boolean

  /** stack 削除時の保持方針（prod は RETAIN） */
  retainResources: boolean

  /** Cognito セルフサインアップ許可（社内ツールは通常 false） */
  cognitoSelfSignUp: boolean

  /** Cognito Hosted UI ドメインプレフィックス（グローバル一意） */
  cognitoDomainPrefix: string

  /** 追加のコールバック URL（CloudFront URL はデプロイ後に別途追加可） */
  additionalCallbackUrls: string[]
  additionalLogoutUrls: string[]

  /** オプション: カスタムドメイン */
  domain?: DomainConfig

  tags: Record<string, string>
}

const BASE_CALLBACKS = [
  'http://localhost:5173/callback',
  'http://localhost:5173/login',
]

const BASE_LOGOUTS = [
  'http://localhost:5173/login',
  'http://localhost:5173/',
]

const ENVIRONMENTS: Record<EnvironmentName, Omit<EnvironmentConfig, 'envName' | 'prefix' | 'tags'>> = {
  dev: {
    region: 'us-east-1',
    useLegacyResourceNames: false,
    retainResources: false,
    cognitoSelfSignUp: true,
    cognitoDomainPrefix: 'taskvista-dev',
    additionalCallbackUrls: [...BASE_CALLBACKS],
    additionalLogoutUrls: [...BASE_LOGOUTS],
  },
  prod: {
    region: 'us-east-1',
    useLegacyResourceNames: true,
    retainResources: true,
    cognitoSelfSignUp: false,
    // 既存 Hosted UI: us-east-1pvlpf6tl0 と衝突しないよう、移行時は import か別 prefix
    cognitoDomainPrefix: 'taskvista-navino',
    additionalCallbackUrls: [
      ...BASE_CALLBACKS,
      'https://taskvista-navino.net/callback',
      'https://www.taskvista-navino.net/callback',
    ],
    additionalLogoutUrls: [
      ...BASE_LOGOUTS,
      'https://taskvista-navino.net/login',
      'https://taskvista-navino.net/',
      'https://www.taskvista-navino.net/login',
      'https://www.taskvista-navino.net/',
    ],
    domain: {
      domainName: 'taskvista-navino.net',
      // certificateArn: 'arn:aws:acm:us-east-1:ACCOUNT:certificate/...'
    },
  },
}

export function getEnvironmentConfig(envName: string): EnvironmentConfig {
  const name = (envName === 'prod' ? 'prod' : 'dev') as EnvironmentName
  const base = ENVIRONMENTS[name]
  return {
    envName: name,
    prefix: `TaskVista-${name}`,
    tags: {
      Project: 'TaskVista',
      Environment: name,
      ManagedBy: 'CDK',
    },
    ...base,
  }
}

/** DynamoDB テーブル物理名（アプリの env デフォルトと揃える） */
export function tableNames(config: EnvironmentConfig) {
  if (config.useLegacyResourceNames) {
    return {
      projects: 'TaskVista-Projects',
      tasks: 'TaskVista-Tasks',
      comments: 'TaskVista-Comments',
      users: 'TaskVista-Users',
    }
  }
  return {
    projects: `${config.prefix}-Projects`,
    tasks: `${config.prefix}-Tasks`,
    comments: `${config.prefix}-Comments`,
    users: `${config.prefix}-Users`,
  }
}

/** S3 バケット名（グローバル一意。account サフィックスで衝突回避） */
export function bucketNames(config: EnvironmentConfig, account: string) {
  if (config.useLegacyResourceNames) {
    return {
      frontend: 'taskvista-frontend',
      attachments: 'taskvista-attachments',
    }
  }
  const short = account.slice(-8)
  return {
    frontend: `taskvista-${config.envName}-frontend-${short}`.toLowerCase(),
    attachments: `taskvista-${config.envName}-attachments-${short}`.toLowerCase(),
  }
}
