import * as cdk from 'aws-cdk-lib'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as iam from 'aws-cdk-lib/aws-iam'
import { Construct } from 'constructs'
import type { EnvironmentConfig } from '../config'

export interface AuthStackProps extends cdk.NestedStackProps {
  config: EnvironmentConfig
  /**
   * CloudFront / カスタムドメイン確定後に追加するコールバック。
   * 初回デプロイ時は localhost + 設定済み URL のみ。
   */
  callbackUrls?: string[]
  logoutUrls?: string[]
}

/**
 * Cognito User Pool + App Client + Hosted UI Domain + Identity Pool
 *
 * アプリは SPA 公開クライアント + Authorization Code + JWT（ID Token）で API を呼ぶ。
 * Identity Pool は将来の一時クレデンシャル用途（現状の Presigned URL 方式でも作成しておく）。
 */
export class AuthStack extends cdk.NestedStack {
  public readonly userPool: cognito.UserPool
  public readonly userPoolClient: cognito.UserPoolClient
  public readonly userPoolDomain: cognito.UserPoolDomain
  public readonly identityPool: cognito.CfnIdentityPool
  public readonly authenticatedRole: iam.Role
  public readonly cognitoDomainUrl: string

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props)

    const { config } = props
    const removal = config.retainResources
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY

    // ── User Pool ──────────────────────────────────────────────
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${config.prefix}-UserPool`,
      signInAliases: { email: true },
      autoVerify: { email: true },
      selfSignUpEnabled: config.cognitoSelfSignUp,
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
        givenName: { required: false, mutable: true },
      },
      // 表示名は主に DynamoDB Users テーブルで管理。Cognito 側にも任意属性を用意。
      customAttributes: {
        display_name: new cognito.StringAttribute({ mutable: true, maxLen: 100 }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      removalPolicy: removal,
    })

    // ── Hosted UI Domain ───────────────────────────────────────
    this.userPoolDomain = this.userPool.addDomain('HostedUiDomain', {
      cognitoDomain: {
        domainPrefix: config.cognitoDomainPrefix,
      },
    })
    this.cognitoDomainUrl = `https://${config.cognitoDomainPrefix}.auth.${this.region}.amazoncognito.com`

    const callbackUrls = unique([
      ...config.additionalCallbackUrls,
      ...(props.callbackUrls ?? []),
    ])
    const logoutUrls = unique([
      ...config.additionalLogoutUrls,
      ...(props.logoutUrls ?? []),
    ])

    // ── App Client（SPA 公開クライアント・シークレットなし） ──
    this.userPoolClient = this.userPool.addClient('SpaClient', {
      userPoolClientName: `${config.prefix}-SpaClient`,
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: false,
        adminUserPassword: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls,
        logoutUrls,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      enableTokenRevocation: true,
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    })

    // ── Identity Pool ──────────────────────────────────────────
    this.identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: `${config.prefix.replace(/-/g, '_')}_IdentityPool`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
          serverSideTokenCheck: true,
        },
      ],
    })

    this.authenticatedRole = new iam.Role(this, 'IdentityAuthenticatedRole', {
      roleName: `${config.prefix}-CognitoAuthRole`,
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': this.identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      description: 'TaskVista Cognito Identity Pool authenticated role (minimal)',
    })
    // 添付は Lambda Presigned URL 経由のため、ここでは広範な S3 権限を付けない

    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoles', {
      identityPoolId: this.identityPool.ref,
      roles: {
        authenticated: this.authenticatedRole.roleArn,
      },
    })

    // ── Outputs ────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${config.prefix}-UserPoolId`,
    })
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito App Client ID (SPA)',
      exportName: `${config.prefix}-UserPoolClientId`,
    })
    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: this.cognitoDomainUrl,
      description: 'Cognito Hosted UI domain',
      exportName: `${config.prefix}-CognitoDomain`,
    })
    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPool.ref,
      description: 'Cognito Identity Pool ID',
      exportName: `${config.prefix}-IdentityPoolId`,
    })
    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      description: 'Cognito User Pool ARN',
    })
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
