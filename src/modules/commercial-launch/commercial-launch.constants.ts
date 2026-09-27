import {
  CommercialLaunchDecision,
  CommercialLaunchItemKind,
} from '@prisma/client';

export type RequiredLaunchItem = {
  itemKey: string;
  kind: CommercialLaunchItemKind;
  requiredDecision?: CommercialLaunchDecision;
  expectedFeatureKey?: string;
};

export const MASTER_REQUIRED_LAUNCH_ITEMS: readonly RequiredLaunchItem[] =
  Object.freeze([
    {
      itemKey: 'surface.core',
      kind: CommercialLaunchItemKind.SURFACE,
      requiredDecision: CommercialLaunchDecision.LAUNCH,
    },
    {
      itemKey: 'surface.web',
      kind: CommercialLaunchItemKind.SURFACE,
      requiredDecision: CommercialLaunchDecision.LAUNCH,
    },
    {
      itemKey: 'service.email',
      kind: CommercialLaunchItemKind.CHANNEL,
      requiredDecision: CommercialLaunchDecision.LAUNCH,
    },
    {
      itemKey: 'service.billing',
      kind: CommercialLaunchItemKind.CHANNEL,
      requiredDecision: CommercialLaunchDecision.LAUNCH,
    },
    {
      itemKey: 'content.external_youtube',
      kind: CommercialLaunchItemKind.CAPABILITY,
      requiredDecision: CommercialLaunchDecision.LAUNCH,
      expectedFeatureKey: 'content.external_youtube',
    },
    {
      itemKey: 'mobile.android',
      kind: CommercialLaunchItemKind.MOBILE,
    },
    {
      itemKey: 'mobile.ios',
      kind: CommercialLaunchItemKind.MOBILE,
    },
    {
      itemKey: 'ai.workout_generation',
      kind: CommercialLaunchItemKind.CAPABILITY,
      expectedFeatureKey: 'ai.workout_generation',
    },
    {
      itemKey: 'ai.content_recommendation',
      kind: CommercialLaunchItemKind.CAPABILITY,
      expectedFeatureKey: 'ai.content_recommendation',
    },
    {
      itemKey: 'creator.iron_managed',
      kind: CommercialLaunchItemKind.CAPABILITY,
      expectedFeatureKey: 'content.iron_managed',
    },
    {
      itemKey: 'creator.tenant_private',
      kind: CommercialLaunchItemKind.CAPABILITY,
      expectedFeatureKey: 'content.tenant_private',
    },
    {
      itemKey: 'provider.wellhub',
      kind: CommercialLaunchItemKind.PROVIDER,
      expectedFeatureKey: 'aggregator.wellhub',
    },
    {
      itemKey: 'provider.totalpass',
      kind: CommercialLaunchItemKind.PROVIDER,
      expectedFeatureKey: 'aggregator.totalpass',
    },
    {
      itemKey: 'channel.meta',
      kind: CommercialLaunchItemKind.CHANNEL,
    },
    {
      itemKey: 'channel.google',
      kind: CommercialLaunchItemKind.CHANNEL,
    },
  ]);
