import * as cdk from 'aws-cdk-lib'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as targets from 'aws-cdk-lib/aws-route53-targets'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'
import { bucketNames, type EnvironmentConfig } from '../config'

export interface FrontendStackProps extends cdk.NestedStackProps {
  config: EnvironmentConfig
}

/**
 * SPA 用 S3 + CloudFront + OAC
 *
 * フロントバケットは OAC の Bucket Policy と同一スタックに置く
 * （Storage と分離すると NestedStack 間で循環参照になるため）。
 *
 * 添付バケット / DynamoDB は StorageStack 側。
 */
export class FrontendStack extends cdk.NestedStack {
  public readonly frontendBucket: s3.Bucket
  public readonly distribution: cloudfront.Distribution
  public readonly distributionDomainName: string
  public readonly appUrl: string

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props)

    const { config } = props
    const removal = config.retainResources
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY
    const buckets = bucketNames(config, cdk.Stack.of(this).account)

    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: buckets.frontend,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      // 静的ウェブサイトホスティングは使わず CloudFront + OAC を推奨
      removalPolicy: removal,
      autoDeleteObjects: !config.retainResources,
    })

    const oac = new cloudfront.S3OriginAccessControl(this, 'FrontendOac', {
      originAccessControlName: `${config.prefix}-frontend-oac`,
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    })

    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.frontendBucket, {
      originAccessControl: oac,
    })

    let certificate: acm.ICertificate | undefined
    let domainNames: string[] | undefined

    if (config.domain?.certificateArn) {
      certificate = acm.Certificate.fromCertificateArn(
        this,
        'CloudFrontCert',
        config.domain.certificateArn,
      )
      domainNames = [config.domain.domainName, `www.${config.domain.domainName}`]
    }

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `TaskVista frontend (${config.envName})`,
      defaultRootObject: 'index.html',
      domainNames,
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
    })

    this.distributionDomainName = this.distribution.distributionDomainName
    this.appUrl = domainNames?.[0]
      ? `https://${domainNames[0]}`
      : `https://${this.distributionDomainName}`

    if (config.domain?.hostedZoneId && config.domain.domainName && certificate) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
        hostedZoneId: config.domain.hostedZoneId,
        zoneName: config.domain.domainName,
      })
      new route53.ARecord(this, 'AliasA', {
        zone,
        recordName: config.domain.domainName,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(this.distribution),
        ),
      })
      new route53.ARecord(this, 'AliasWww', {
        zone,
        recordName: `www.${config.domain.domainName}`,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(this.distribution),
        ),
      })
    }

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: this.frontendBucket.bucketName,
      exportName: `${config.prefix}-FrontendBucket`,
    })
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: this.appUrl,
      description: 'Frontend URL (custom domain or CloudFront)',
      exportName: `${config.prefix}-CloudFrontUrl`,
    })
    new cdk.CfnOutput(this, 'CloudFrontDomainName', {
      value: this.distributionDomainName,
      description: 'CloudFront distribution domain',
      exportName: `${config.prefix}-CloudFrontDomain`,
    })
    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID（キャッシュ無効化用）',
      exportName: `${config.prefix}-CloudFrontDistributionId`,
    })
  }
}
