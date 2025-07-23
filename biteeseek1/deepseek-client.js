const axios = require('axios');
const MCPClient = require('./mcpclient');
require('dotenv').config();

class DeepseekClient {
    constructor(apiKey = process.env.DEEPSEEK_API_KEY, baseURL = 'https://chat.bitseek.ai/api/v1') {
        if (!apiKey) {
            throw new Error('Deepseek API 密钥未设置。请在 .env 文件中设置 DEEPSEEK_API_KEY');
        }
        this.apiKey = apiKey;
        this.baseURL = baseURL;
        this.client = axios.create({
            baseURL,
            timeout: 300000,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            }
        });

        this.mcpClient = new MCPClient(process.env.MCP_SERVER_URL);
    }

    async generateResponse(prompt) {
        try {
            const response = await this.client.post('/generate', new URLSearchParams({
                model: "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
                inputs: prompt,
                max_length: 512
            }).toString());

            return response.data;
        } catch (error) {
            throw new Error(`Deepseek API 调用失败: ${error.message}`);
        }
    }

    async processSmartQuery(query) {
        try {
            // 检查是否是 MCP 操作查询
            const mcpOperations = ['createAccount', 'getBalance', 'transfer', 'callContract'];
            const isMCPQuery = mcpOperations.some(op => query.toLowerCase().includes(op.toLowerCase()));
            
            if (isMCPQuery) {
                // 尝试解析 MCP 操作参数
                const operation = this.parseMCPOperation(query);
                if (operation) {
                    return await this.processMCPOperationWithAI(operation.type, operation.params, query);
                }
            }
            
            // 如果不是 MCP 操作，使用 AI 处理
            return await this.processAIQuery(query);
        } catch (error) {
            return {
                success: false,
                error: `智能查询处理失败: ${error.message}`,
                type: 'smart_query'
            };
        }
    }

    parseMCPOperation(query) {
        const lowerQuery = query.toLowerCase();
        
        // 解析创建账户
        if (lowerQuery.includes('create') && lowerQuery.includes('account') || 
            lowerQuery.includes('创建') && lowerQuery.includes('账户') ||
            lowerQuery.includes('创建') && lowerQuery.includes('账号')) {
            return { type: 'createAccount', params: {} };
        }
        
        // 解析查询余额
        if (lowerQuery.includes('balance') || lowerQuery.includes('余额') || lowerQuery.includes('查询余额')) {
            // 尝试从查询中提取地址
            const addressMatch = query.match(/0x[a-fA-F0-9]{40,}/);
            if (addressMatch) {
                return { 
                    type: 'getBalance', 
                    params: { address: addressMatch[0] } 
                };
            }
            // 如果没有找到地址，返回需要地址的提示
            return { 
                type: 'getBalance', 
                params: { address: null } 
            };
        }
        
        // 解析转账
        if (lowerQuery.includes('transfer') || lowerQuery.includes('转账')) {
            // 尝试从查询中提取参数
            const amountMatch = query.match(/(\d+(?:\.\d+)?)/);
            const addressMatch = query.match(/0x[a-fA-F0-9]{40,}/g);
            
            if (amountMatch && addressMatch && addressMatch.length >= 2) {
                return {
                    type: 'transfer',
                    params: {
                        recipient: addressMatch[1],
                        amount: amountMatch[0],
                        senderPrivateKey: null // 需要用户提供
                    }
                };
            }
            return { 
                type: 'transfer', 
                params: { 
                    recipient: null, 
                    amount: null, 
                    senderPrivateKey: null 
                } 
            };
        }
        
        // 解析合约调用
        if (lowerQuery.includes('contract') || lowerQuery.includes('合约')) {
            return { 
                type: 'callContract', 
                params: { 
                    privateKey: null,
                    packageObjectId: null,
                    module: null,
                    functionName: null,
                    args: [],
                    typeArguments: []
                } 
            };
        }
        
        return null;
    }

    async processAIQuery(query) {
        try {
            // 使用 AI 处理查询
            const response = await this.generateResponse(query);
            
            // 检查响应是否包含有用的信息
            if (response && response.text) {
                return {
                    success: true,
                    response: response.text,
                    type: 'ai_response'
                };
            } else {
                return {
                    success: false,
                    error: 'AI 响应格式无效',
                    type: 'ai_response'
                };
            }
        } catch (error) {
            return {
                success: false,
                error: `AI 查询处理失败: ${error.message}`,
                type: 'ai_response'
            };
        }
    }

    async processMCPOperationWithAI(operation, params, originalQuery) {
        try {
            let mcpResult;
            
            // 执行 MCP 操作
            switch (operation) {
                case 'createAccount':
                    mcpResult = await this.mcpClient.createAccount();
                    break;
                case 'getBalance':
                    if (!params.address) {
                        return {
                            success: false,
                            error: '请提供要查询余额的地址',
                            type: 'mcp_operation',
                            needsAddress: true
                        };
                    }
                    mcpResult = await this.mcpClient.getBalance(params.address);
                    break;
                case 'transfer':
                    if (!params.senderPrivateKey || !params.recipient || !params.amount) {
                        return {
                            success: false,
                            error: '请提供完整的转账信息：发送方私钥、接收方地址和转账金额',
                            type: 'mcp_operation',
                            needsTransferInfo: true
                        };
                    }
                    mcpResult = await this.mcpClient.transfer(
                        params.senderPrivateKey,
                        params.recipient,
                        params.amount
                    );
                    break;
                case 'callContract':
                    if (!params.privateKey || !params.packageObjectId || !params.module || !params.functionName) {
                        return {
                            success: false,
                            error: '请提供完整的合约调用信息',
                            type: 'mcp_operation',
                            needsContractInfo: true
                        };
                    }
                    mcpResult = await this.mcpClient.callContract(
                        params.privateKey,
                        params.packageObjectId,
                        params.module,
                        params.functionName,
                        params.args || [],
                        params.typeArguments || []
                    );
                    break;
                default:
                    throw new Error(`不支持的操作: ${operation}`);
            }

            // 通过大模型整理结果
            const formattedResult = await this.formatMCPResultWithAI(operation, mcpResult, originalQuery);
            
            return {
                success: true,
                response: formattedResult,
                type: 'mcp_operation_with_ai',
                rawResult: mcpResult
            };
            
        } catch (error) {
            // 检查是否是网络错误
            if (error.message.includes('Network Error') || error.message.includes('timeout')) {
                throw new Error('网络连接失败，请检查网络连接和 MCP 服务器状态');
            }
            // 检查是否是服务器错误
            if (error.response) {
                throw new Error(`MCP 服务器错误: ${error.response.data?.error || error.message}`);
            }
            throw new Error(`处理 MCP 操作失败: ${error.message}`);
        }
    }

    async formatMCPResultWithAI(operation, mcpResult, originalQuery) {
        try {
            let prompt;
            
            switch (operation) {
                case 'createAccount':
                    prompt = `用户请求创建账户，MCP 操作返回了以下结果：${JSON.stringify(mcpResult, null, 2)}

请用友好的中文回复用户，说明账户创建成功，并提供以下信息：
1. 账户地址
2. 私钥（提醒用户安全保管）
3. 下一步可以进行的操作（如查询余额、转账等）

请用自然、易懂的语言回复，不要直接显示 JSON 数据。`;
                    break;
                    
                case 'getBalance':
                    prompt = `用户查询账户余额，查询地址：${mcpResult.address || '未知地址'}，MCP 操作返回了以下结果：${JSON.stringify(mcpResult, null, 2)}

请用友好的中文回复用户，说明余额查询结果，包括：
1. 查询的地址
2. 账户余额
3. 余额单位说明
4. 其他相关信息

请用自然、易懂的语言回复，不要直接显示 JSON 数据。`;
                    break;
                    
                case 'transfer':
                    prompt = `用户执行转账操作，MCP 操作返回了以下结果：${JSON.stringify(mcpResult, null, 2)}

请用友好的中文回复用户，说明转账结果，包括：
1. 转账是否成功
2. 交易哈希（如果有）
3. 转账金额和接收方
4. 其他相关信息

请用自然、易懂的语言回复，不要直接显示 JSON 数据。`;
                    break;
                    
                case 'callContract':
                    prompt = `用户调用智能合约，MCP 操作返回了以下结果：${JSON.stringify(mcpResult, null, 2)}

请用友好的中文回复用户，说明合约调用结果，包括：
1. 调用是否成功
2. 交易哈希（如果有）
3. 返回结果（如果有）
4. 其他相关信息

请用自然、易懂的语言回复，不要直接显示 JSON 数据。`;
                    break;
                    
                default:
                    prompt = `MCP 操作返回了以下结果：${JSON.stringify(mcpResult, null, 2)}

请用友好的中文回复用户，说明操作结果。请用自然、易懂的语言回复，不要直接显示 JSON 数据。`;
            }
            
            const aiResponse = await this.generateResponse(prompt);
            return aiResponse.text || '操作完成，但无法格式化结果';
            
        } catch (error) {
            // 如果 AI 格式化失败，返回原始结果
            return `操作完成。结果：${JSON.stringify(mcpResult, null, 2)}`;
        }
    }

    async processMCPOperation(operation, params) {
        try {
            // 直接执行 MCP 操作，不再通过 AI 处理
            switch (operation) {
                case 'createAccount':
                    return await this.mcpClient.createAccount();
                case 'getBalance':
                    if (!params.address) {
                        throw new Error('缺少地址参数');
                    }
                    return await this.mcpClient.getBalance(params.address);
                case 'transfer':
                    if (!params.senderPrivateKey || !params.recipient || !params.amount) {
                        throw new Error('缺少必要的转账参数');
                    }
                    return await this.mcpClient.transfer(
                        params.senderPrivateKey,
                        params.recipient,
                        params.amount
                    );
                case 'callContract':
                    if (!params.privateKey || !params.packageObjectId || !params.module || !params.functionName) {
                        throw new Error('缺少必要的合约调用参数');
                    }
                    return await this.mcpClient.callContract(
                        params.privateKey,
                        params.packageObjectId,
                        params.module,
                        params.functionName,
                        params.args || [],
                        params.typeArguments || []
                    );
                default:
                    throw new Error(`不支持的操作: ${operation}`);
            }
        } catch (error) {
            // 检查是否是网络错误
            if (error.message.includes('Network Error') || error.message.includes('timeout')) {
                throw new Error('网络连接失败，请检查网络连接和 MCP 服务器状态');
            }
            // 检查是否是服务器错误
            if (error.response) {
                throw new Error(`MCP 服务器错误: ${error.response.data?.error || error.message}`);
            }
            throw new Error(`处理 MCP 操作失败: ${error.message}`);
        }
    }
}

// 使用示例
async function main() {
    const client = new DeepseekClient();

    try {
        // 智能查询示例
        console.log('=== 智能查询示例 ===');
        const smartResponse = await client.processSmartQuery("创建账户");
        if (smartResponse.success) {
            console.log('智能查询回复:', smartResponse.response);
        } else {
            console.error('智能查询失败:', smartResponse.error);
        }

        // AI 查询示例
        console.log('\n=== AI 查询示例 ===');
        const aiResponse = await client.processAIQuery("What is the capital of China?");
        if (aiResponse.success) {
            console.log('AI 回复:', aiResponse.response);
        } else {
            console.error('AI 查询失败:', aiResponse.error);
        }

        console.log('\n=== MCP 操作示例 ===');
        // 创建账户
        const account = await client.processMCPOperationWithAI('createAccount', {}, "create account");
        if (account.success) {
            console.log('创建账户成功:', account.response);
        } else {
            console.error('创建账户失败:', account.error);
        }

        // 查询余额
        if (account.success && account.rawResult && account.rawResult.address) {
            const balance = await client.processMCPOperationWithAI('getBalance', {
                address: account.rawResult.address
            }, "get balance");
            if (balance.success) {
                console.log('账户余额:', balance.response);
            } else {
                console.error('查询余额失败:', balance.error);
            }
        }

        // 转账示例（需要有效的私钥和地址）
        console.log('\n=== 转账示例（需要有效参数）===');
        const transfer = await client.processMCPOperationWithAI('transfer', {
            senderPrivateKey: 'your_private_key_here',
            recipient: '0xrecipient_address',
            amount: '100000000'
        }, "transfer 100000000 to 0xrecipient_address");
        if (transfer.success) {
            console.log('转账结果:', transfer.response);
        } else {
            console.error('转账失败:', transfer.error);
        }
    } catch (error) {
        console.error('操作失败:', error.message);
    }
}

// 移除自动执行
// main();

module.exports = DeepseekClient;
