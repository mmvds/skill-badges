# Решение Skill Badges
[Решение Skill Badges для хакатона](https://moretech.vtb.ru/nft) 
основано на имплементациях и объединении следующих стандартов:

ERC-6220(Equippable NFT) + ERC-7401 (Nestable NFT) + ERC-6454 (SBT NFT) + ERC-5773 (Multiasset NFT) + ERC-7508 (attributes storage)

# Установка и компиляция

```bash
npm install -g pnpm
pnpm i
pnpm hardhat compile
```

# Настройка env
Для тестирования использовалась base sepolia, поддерживается dev версией для разработки от rmrk, необходимо задать в .env
```bash
BASE_SEPOLIA_URL=<RPC url, можно получить, например на https://app.infura.io/>
BASESCAN_API_KEY=<API key для верификации можно получить на https://sepolia.basescan.org/>
PRIVATE_KEY=<ключ от кошелька с небольшим количеством тестовых base sepolia/>
```

# Локальное развертывание контрактов
```bash
pnpm hardhat run ./scripts/run-deploy.ts 
```

# Развертывание на сети baseSepolia
Для работы с сетью потребуется небольшое количество тестовых монет
[Можно получить тут](https://docs.base.org/docs/tools/network-faucets) 
Достаточно < 0.1 ETH sepolia testnet

```bash
pnpm hardhat run ./scripts/run-deploy.ts --network baseSepolia 
```
