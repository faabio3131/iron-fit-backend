import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAbsolute, resolve } from 'node:path';

export interface LocalEncryptedVaultSettings {
  directory: string;
  masterKeyFile: string;
}

function required(config: ConfigService, key: string): string {
  const value = config.get<string>(key)?.trim();
  if (!value) throw new Error(key + ' obrigatorio para LOCAL_ENCRYPTED Vault');
  return value;
}

@Injectable()
export class LocalEncryptedVaultConfigurationService {
  constructor(private readonly config: ConfigService) {}

  requireSettings(): LocalEncryptedVaultSettings {
    const directory = required(this.config, 'LOCAL_ENCRYPTED_VAULT_DIRECTORY');
    const masterKeyFile = required(this.config, 'LOCAL_ENCRYPTED_VAULT_MASTER_KEY_FILE');
    if (!isAbsolute(directory) || !isAbsolute(masterKeyFile)) {
      throw new Error('LOCAL_ENCRYPTED Vault exige caminhos absolutos');
    }
    if (resolve(directory) === resolve(masterKeyFile)
      || resolve(masterKeyFile).startsWith(resolve(directory) + '/')) {
      throw new Error('Chave mestra deve ficar fora do diretorio de segredos');
    }
    return { directory: resolve(directory), masterKeyFile: resolve(masterKeyFile) };
  }
}
