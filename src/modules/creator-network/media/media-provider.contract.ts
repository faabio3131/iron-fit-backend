export interface CreatorMediaPrepareUploadInput {
  objectKey: string;
  mimeType: string;
  expectedSha256: string;
}

export interface CreatorMediaUploadInstructions {
  method: 'PUT' | 'POST';
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface CreatorMediaInspectObjectInput {
  objectKey: string;
}

export interface CreatorMediaInspectedObject {
  exists: boolean;
  sizeBytes?: bigint | number | string;
  sha256?: string;
  etag?: string | null;
}

export interface CreatorMediaResolveDeliveryInput {
  objectKey: string;
}

export interface CreatorMediaDeliveryReference {
  url: string;
  expiresAt?: Date | null;
}

export interface CreatorMediaProvider {
  readonly providerCode: string;
  prepareUpload(
    input: CreatorMediaPrepareUploadInput,
  ): Promise<CreatorMediaUploadInstructions>;
  inspectObject(
    input: CreatorMediaInspectObjectInput,
  ): Promise<CreatorMediaInspectedObject>;
  resolveDelivery(
    input: CreatorMediaResolveDeliveryInput,
  ): Promise<CreatorMediaDeliveryReference>;
}
