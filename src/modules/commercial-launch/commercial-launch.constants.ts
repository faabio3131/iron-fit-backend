import {
  CommercialLaunchDecision,
  CommercialLaunchItemKind,
} from '@prisma/client';

export type RequiredLaunchItem = {
  itemKey: string;
  kind: CommercialLaunchItemKind;
  requiredDecision?: CommercialLaunchDecision;
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
    },
    {
      itemKey: 'ai.content_recommendation',
      kind: CommercialLaunchItemKind.CAPABILITY,
    },
    {
      itemKey: 'creator.iron_managed',
      kind: CommercialLaunchItemKind.CAPABILITY,
    },
    {
      itemKey: 'creator.tenant_private',
      kind: CommercialLaunchItemKind.CAPABILITY,
    },
    {
      itemKey: 'provider.wellhub',
      kind: CommercialLaunchItemKind.PROVIDER,
    },
    {
      itemKey: 'provider.totalpass',
      kind: CommercialLaunchItemKind.PROVIDER,
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
