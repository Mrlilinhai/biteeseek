const axios = require('axios');

class MCPClient {
    constructor(baseURL = 'http://localhost:3000') {
        this.baseURL = baseURL;
        this.client = axios.create({
            baseURL,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    // 查询余额
    async getBalance(address) {
        try {
            const response = await this.client.get(`/balance/${address}`);
            return response.data;
        } catch (error) {
            throw new Error(`查询余额失败: ${error.message}`);
        }
    }

    // 查询 SUI 余额
    async getSuiBalance(address) {
        try {
            const response = await this.client.get(`/balance/sui/${address}`);
            return response.data;
        } catch (error) {
            throw new Error(`查询 SUI 余额失败: ${error.message}`);
        }
    }

    // 创建账户
    async createAccount() {
        try {
            const response = await this.client.get('/account/create');
            return response.data;
        } catch (error) {
            throw new Error(`创建账户失败: ${error.message}`);
        }
    }

    // SUI转账
    async transfer(senderPrivateKey, recipient, amount) {
        try {
            const response = await this.client.post('/transfer', {
                senderPrivateKey,
                recipient,
                amount
            });
            return response.data;
        } catch (error) {
            throw new Error(`转账失败: ${error.message}`);
        }
    }

    // 部署代币合约
    async deployToken(privateKey) {
        try {
            const response = await this.client.post('/token/deploy', { privateKey });
            return response.data;
        } catch (error) {
            throw new Error(`部署代币合约失败: ${error.message}`);
        }
    }

    // 铸造代币
    async mintToken(privateKey, packageId, treasuryCapId, recipient, amount) {
        try {
            const response = await this.client.post('/token/mint', {
                privateKey,
                packageId,
                treasuryCapId,
                recipient,
                amount
            });
            return response.data;
        } catch (error) {
            throw new Error(`铸造代币失败: ${error.message}`);
        }
    }

    // 使用Sui原生功能创建代币
    async createToken(privateKey, name, symbol, decimals, description = '', url = '') {
        try {
            const response = await this.client.post('/token/create', {
                privateKey,
                name,
                symbol,
                decimals,
                description,
                url
            });
            return response.data;
        } catch (error) {
            throw new Error(`创建代币失败: ${error.message}`);
        }
    }

    // 自定义代币转账
    async transferToken(privateKey, packageId, coinType, senderCoinId, recipient, amount) {
        try {
            const response = await this.client.post('/token/transfer', {
                privateKey,
                packageId,
                coinType,
                senderCoinId,
                recipient,
                amount
            });
            return response.data;
        } catch (error) {
            throw new Error(`自定义代币转账失败: ${error.message}`);
        }
    }
}

// 使用示例
async function example() {
    const client = new MCPClient();

    try {
        // 创建账户
        const account = await client.createAccount();
        console.log('创建账户成功:', account);

        // 查询余额
        const balance = await client.getBalance(account.address);
        console.log('账户余额:', balance);

        // 转账示例
        const transferResult = await client.transfer(
            account.privateKey,
            '0xrecipient_address',
            '100000000'
        );
        console.log('转账结果:', transferResult);

    } catch (error) {
        console.error('操作失败:', error.message);
    }
}

module.exports = MCPClient; 