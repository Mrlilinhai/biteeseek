const WebSocket = require('ws');
const MCPClient = require('../mcpclient');
require('dotenv').config();

/**
 * BitseekClient - WebSocket客户端，支持AI聊天和MCP区块链操作
 * 重构版：结构更清晰，流程更简洁，日志和调试信息全部保留
 */
class BitseekClient {
    constructor(wsUrl = 'wss://chat.bitseek.ai/api/v2/generate', config = {}) {
        // 配置集中管理
        this.config = {
            HEARTBEAT_INTERVAL: parseInt(process.env.HEARTBEAT_INTERVAL) || 600000,
            MESSAGE_TIMEOUT: parseInt(process.env.MESSAGE_TIMEOUT) || 600000,
            MCP_TIMEOUT: parseInt(process.env.MCP_TIMEOUT) || 6000000,
            RETRY_DELAY: parseInt(process.env.RETRY_DELAY) || 1000,
            MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 1,
            VERBOSE_LOGGING: process.env.VERBOSE_LOGGING === 'true',
            DEBUG_MODE: process.env.DEBUG_MODE === 'true',
            MCP_SERVER_URL: process.env.MCP_SERVER_URL,
            ...config
        };
        this.wsUrl = wsUrl;
        this.ws = null;
        this.connectionStatus = 'disconnected';
        this.isReconnecting = false;
        this.connectionPromise = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectInterval = 1000;
        this.heartbeatTimer = null;
        this.stopSeqs = ['</s>'];
        this.currentResponse = '';
        this.resolveCurrentRequest = null;
        this.rawResponseBuffer = '';
        this.streamCallback = null;
        this.streamUpdateInterval = 200;
        this.debugMode = this.config.DEBUG_MODE;
        this.enableVerboseLogging = this.config.VERBOSE_LOGGING;
        this.mcpClient = new MCPClient(this.config.MCP_SERVER_URL);
        this.MCP_OPERATIONS = {
            CREATE_ACCOUNT: 'createAccount',
            GET_BALANCE: 'getBalance',
            TRANSFER: 'transfer',
            CALL_CONTRACT: 'callContract'
        };
        this._logInitInfo();
    }

    // ==================== 日志 ====================
    _logInitInfo() {
        console.log('[BitseekClient] 客户端初始化完成');
        console.log('[BitseekClient] WebSocket URL:', this.wsUrl);
        console.log('[BitseekClient] MCP Server URL:', this.config.MCP_SERVER_URL || 'localhost:3000');
        console.log('[BitseekClient] 心跳配置 - 心跳间隔:', this.config.HEARTBEAT_INTERVAL, 'ms');
        console.log('[BitseekClient] 超时配置 - 消息超时:', this.config.MESSAGE_TIMEOUT, 'ms, MCP超时:', this.config.MCP_TIMEOUT, 'ms');
        console.log('[BitseekClient] 重试配置 - 最大重试次数:', this.config.MAX_RETRIES, ', 重试延迟:', this.config.RETRY_DELAY, 'ms');
    }

    // ==================== 配置管理 ====================
    setTimeouts({ messageTimeout, mcpTimeout, retryDelay, maxRetries, heartbeatInterval } = {}) {
        if (messageTimeout !== undefined) this.config.MESSAGE_TIMEOUT = messageTimeout;
        if (mcpTimeout !== undefined) this.config.MCP_TIMEOUT = mcpTimeout;
        if (retryDelay !== undefined) this.config.RETRY_DELAY = retryDelay;
        if (maxRetries !== undefined) this.config.MAX_RETRIES = maxRetries;
        if (heartbeatInterval !== undefined) this.setHeartbeatInterval(heartbeatInterval);
        console.log('[BitseekClient] 超时/重试/心跳配置已更新:', this.config);
    }
    getTimeoutConfig() {
        return { ...this.config };
    }

    // ==================== 连接管理 ====================
    isConnectionHealthy() {
        const healthy = this.ws && this.ws.readyState === WebSocket.OPEN && this.connectionStatus === 'connected';
        if (!healthy) {
            console.log('[BitseekClient] 连接状态检查:', {
                wsExists: !!this.ws,
                readyState: this.ws ? this.ws.readyState : 'null',
                connectionStatus: this.connectionStatus
            });
        }
        return healthy;
    }
    async connect() {
        console.log('[BitseekClient] 开始连接WebSocket...');
        if (this.isConnectionHealthy()) {
            console.log('[BitseekClient] 连接已存在且健康，跳过连接');
            return;
        }
        if (this.isReconnecting && this.connectionPromise) {
            console.log('[BitseekClient] 连接正在进行中，等待完成...');
            return this.connectionPromise;
        }
        this.isReconnecting = true;
        this.connectionPromise = this._connect();
        try {
            await this.connectionPromise;
            console.log('[BitseekClient] WebSocket连接成功建立');
        } catch (error) {
            console.error('[BitseekClient] WebSocket连接失败:', error.message);
            throw error;
        } finally {
            this.isReconnecting = false;
            this.connectionPromise = null;
        }
    }
    async _connect() {
        return new Promise((resolve, reject) => {
            try {
                console.log('[BitseekClient] 创建WebSocket实例...');
                this.ws = new WebSocket(this.wsUrl);
                this.ws.on('open', () => {
                    console.log('[BitseekClient] WebSocket连接已建立');
                    this.connectionStatus = 'connected';
                    this.reconnectAttempts = 0;
                    this.ws.send(JSON.stringify({
                        type: "open_inference_session",
                        model: "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
                        max_length: 1024,
                    }));
                    this.setHeartbeatInterval(this.config.HEARTBEAT_INTERVAL);
                    resolve();
                });
                this.ws.on('message', (data) => this._handleMessage(data));
                this.ws.on('close', (code, reason) => {
                    console.log('[BitseekClient] WebSocket连接关闭:', { code, reason: reason.toString() });
                    this.connectionStatus = 'disconnected';
                    this.stopHeartbeat();
                    if (code !== 1000 && !this.isReconnecting) {
                        console.log('[BitseekClient] 非正常关闭，准备重连...');
                        this.scheduleReconnect();
                    }
                });
                this.ws.on('error', (error) => {
                    console.error('[BitseekClient] WebSocket错误:', error.message);
                    this.connectionStatus = 'disconnected';
                    if (!this.isReconnecting) reject(error);
                });
            } catch (error) {
                console.error('[BitseekClient] 创建WebSocket实例失败:', error.message);
                reject(error);
            }
        });
    }
    disconnect() {
        console.log('[BitseekClient] 主动关闭连接');
        this.connectionStatus = 'disconnected';
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.close(1000, '正常关闭');
            this.ws = null;
        }
    }
    scheduleReconnect() {
        if (this.isReconnecting) {
            console.log('[BitseekClient] 已在重连中，跳过');
            return;
        }
        this.reconnectAttempts++;
        if (this.reconnectAttempts <= this.maxReconnectAttempts) {
            console.log(`[BitseekClient] ${this.reconnectInterval}ms后尝试重连... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => {
                this.connect().catch(err => {
                    console.error('[BitseekClient] 重连失败:', err.message);
                });
            }, this.reconnectInterval);
        } else {
            console.error('[BitseekClient] 达到最大重连次数，停止重连');
        }
    }

    // ==================== 心跳管理 ====================
    setHeartbeatInterval(interval) {
        this.config.HEARTBEAT_INTERVAL = interval;
        this.stopHeartbeat();
        this.startHeartbeat();
        console.log('[BitseekClient] 心跳间隔已更新为:', interval, 'ms');
    }
    startHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: "ping" }));
            } else {
                console.log('[BitseekClient] 心跳跳过 - WebSocket未连接');
            }
        }, this.config.HEARTBEAT_INTERVAL);
        console.log('[BitseekClient] 启动心跳机制，间隔:', this.config.HEARTBEAT_INTERVAL, 'ms');
    }
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
            console.log('[BitseekClient] 停止心跳机制');
        }
    }

    // ==================== 消息与响应 ====================
    async sendMessage(message, streamCallback = null) {
        this.setStreamCallback(streamCallback);
        if (!this.isConnectionHealthy()) {
            console.log('[BitseekClient] 连接不健康，尝试重新连接...');
            await this.connect();
        }
        return this.withTimeout(() => this._send(message), this.config.MESSAGE_TIMEOUT);
    }
    async _send(message) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                const error = new Error('WebSocket连接未建立');
                console.error('[BitseekClient] 发送消息失败:', error.message);
                reject(error);
                return;
            }
            this.currentResponse = '';
            this.resolveCurrentRequest = resolve;
            this.rawResponseBuffer = '';
            const messageData = {
                type: "generate",
                inputs: message,
                max_new_tokens: 1,
                max_length: 2048,
                do_sample: 1,
                temperature: 0.7,
                top_p: 1.1,
                stop_sequence: "###",
                extra_stop_sequences: this.stopSeqs,
            };
            try {
                this.ws.send(JSON.stringify(messageData));
                console.log('[BitseekClient] 消息已发送，等待响应...');
            } catch (sendError) {
                console.error('[BitseekClient] 发送消息时出错:', sendError.message);
                reject(new Error(`发送消息失败: ${sendError.message}`));
                return;
            }
            // resolveCurrentRequest 会在 onResponseComplete 里调用
        });
    }
    withTimeout(fn, timeout) {
        return new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => {
                console.error('[BitseekClient] 操作超时');
                reject(new Error('操作超时'));
            }, timeout);
            try {
                const result = await fn();
                clearTimeout(timer);
                resolve(result);
            } catch (e) {
                clearTimeout(timer);
                reject(e);
            }
        });
    }
    _handleMessage(data) {
        // 新增：打印所有实时收到的数据
        // console.log('[BitseekClient] 实时收到数据:', data.toString());
        try {
            const resp = JSON.parse(data.toString());
            if (resp.outputs) {
                this.handleStreamResponse(resp);
            } else if (resp.error) {
                console.error('[BitseekClient] 服务器返回错误:', resp.error);
                if (this.resolveCurrentRequest) {
                    this.resolveCurrentRequest(`错误: ${resp.error}`);
                    this.resolveCurrentRequest = null;
                    this.currentResponse = '';
                }
            } else if (resp.type === 'pong') {
                // 心跳响应
            } else if (resp.ok) {
                // 确认消息
            } else {
                console.log('[BitseekClient] 处理其他类型响应:', resp.type || 'undefined');
                if (this.resolveCurrentRequest && this.currentResponse) {
                    this.onResponseComplete();
                }
            }
        } catch (e) {
            console.error('[BitseekClient] 消息解析失败:', e.message);
            console.error('[BitseekClient] 原始数据:', data.toString());
        }
    }
    setStreamCallback(callback) {
        this.streamCallback = callback;
    }
    handleStreamResponse(resp) {
        if (!this.rawResponseBuffer) this.rawResponseBuffer = '';
        this.rawResponseBuffer += resp.outputs;
        const shouldStop = resp.stop || this.interrupt(resp.outputs);
        if (shouldStop) {
            console.log('[BitseekClient] 响应结束，总长度:', this.currentResponse.length);
            this.onResponseComplete();
        } else {
            const cleanedOutput = this.cleanStreamContent(resp.outputs);
            if (!cleanedOutput) {
                console.log('[BitseekClient] 清理后内容为空，跳过处理');
                return;
            }
            this.currentResponse += cleanedOutput;
            if (this.streamCallback && typeof this.streamCallback === 'function') {
                this.streamCallback(cleanedOutput);
            }
            if (this.debugMode || this.enableVerboseLogging) {
                console.log('[BitseekClient] 收到流式内容:', {
                    original: resp.outputs.substring(0, 30) + '...',
                    cleaned: cleanedOutput.substring(0, 30) + '...',
                    totalLength: this.currentResponse.length
                });
            }
            if (this.currentResponse.length > 15000) {
                console.log('[BitseekClient] 响应内容过长，强制结束');
                this.onResponseComplete();
            }
        }
    }
    cleanStreamContent(content) {
        if (!content || content.length === 0) return '';
        let cleaned = content
            .replace(/<think>[\s\S]*?<\/think>/g, "")
            .replace(/<\| begin of sentence \|>/g, "")
            .replace(/<\| end of sentence \|>/g, "")
            .replace(/<\| begin__of__sentence \|>/g, "")
            .replace(/<\| end__of__sentence \|>/g, "")
            .replace(/<\/s>/g, "")
            .replace(/REDACTED_SPECIAL_TOKEN/g, "")
            .replace(/<\|end_header_id\|>/g, "")
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
        if (cleaned.trim() === '') return '';
        if (cleaned.length > 10 && (this.debugMode || this.enableVerboseLogging)) {
            console.log('[BitseekClient] 清理后内容长度:', cleaned.length, '内容预览:', cleaned.substring(0, 50) + '...');
        }
        return cleaned;
    }
    interrupt(text) {
        const shouldInterrupt = this.stopSeqs.some(seq => text.includes(seq));
        if (shouldInterrupt) {
            console.log('[BitseekClient] 检测到停止序列，中断响应');
        }
        return shouldInterrupt;
    }
    onResponseComplete() {
        if (this.resolveCurrentRequest) {
            console.log('[BitseekClient] 响应完成，最终长度:', this.currentResponse.length);
            this.resolveCurrentRequest(this.currentResponse);
            this.resolveCurrentRequest = null;
            this.currentResponse = '';
            this.rawResponseBuffer = '';
            this.streamCallback = null;
        }
    }

    // ==================== AI 响应处理 ====================
    parseAIResponse(response, context = 'general') {
        console.log('[BitseekClient] 解析AI响应，上下文:', context);
        try {
            let parsed = response;
            if (typeof response === 'string') {
                parsed = response.trim().replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
            } else if (response && response.data && response.data.outputs) {
                parsed = response.data.outputs;
            } else if (response && typeof response === 'object') {
                if (response.outputs) parsed = response.outputs;
                else if (response.content) parsed = response.content;
                else if (response.text) parsed = response.text;
                else if (response.message) parsed = response.message;
                else if (response.response) parsed = response.response;
                else if (response.data && typeof response.data === 'string') {
                    try {
                        const parsedData = JSON.parse(response.data);
                        if (parsedData.outputs) parsed = parsedData.outputs;
                        else if (parsedData.content) parsed = parsedData.content;
                        else parsed = parsedData;
                    } catch (e) {
                        parsed = response.data;
                    }
                } else {
                    parsed = JSON.stringify(response, null, 2);
                }
            }
            if (context === 'judge') {
                const start = typeof parsed === 'string' ? parsed.indexOf('{') : -1;
                if (start !== -1) {
                    for (let end = start + 1; end <= parsed.length; end++) {
                        const candidate = parsed.slice(start, end);
                        try {
                            const result = JSON.parse(candidate);
                            console.log('[BitseekClient] 成功解析JSON判断结果');
                            return result;
                        } catch (e) {}
                    }
                }
                throw new Error('未找到完整 JSON 格式内容');
            }
            if (context === 'summary') {
                let formatted = typeof parsed === 'string' ? parsed.trim().replace(/\n{3,}/g, '\n\n') : JSON.stringify(parsed, null, 2);
                if (typeof formatted === 'string' && formatted.length > 200) {
                    formatted = '\n' + '─'.repeat(50) + '\n' + formatted + '\n' + '─'.repeat(50);
                }
                return formatted;
            }
            if (context === 'error') {
                const errorMsg = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
                return `❌ 错误: ${errorMsg}`;
            }
            if (context === 'success') {
                const successMsg = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
                return `✅ ${successMsg}`;
            }
            return parsed;
        } catch (error) {
            console.error('[BitseekClient] 解析AI响应失败:', error.message);
            return String(response);
        }
    }

    // ==================== 智能判断 ====================
    async aiJudgeOperation(input, streamCallback = null) {
        console.log('[BitseekClient] 使用AI大模型判断:', input);
        const judgePrompt = `你是一个智能助手，需要判断用户的输入是否涉及区块链操作。\n\n用户输入: "${input}"\n\n请分析用户输入，判断是否需要进行区块链操作。如果是区块链操作，请返回JSON格式的结果；如果不是，请返回false。\n\n支持的区块链操作类型：\n1. createAccount - 创建账户/钱包\n2. getBalance - 查询余额\n3. transfer - 转账操作\n4. callContract - 调用智能合约\n\n判断标准：\n- 如果用户提到创建账户、钱包、账号等，返回createAccount\n- 如果用户提到查询余额、查看余额、检查余额等，返回getBalance\n- 如果用户提到转账、转钱、发送、支付等，返回transfer\n- 如果用户提到调用合约、执行合约、运行合约等，返回callContract\n- 如果是一般聊天、咨询、技术支持等，返回false\n\n请严格按照以下JSON格式返回：\n{\n  "isMCP": true/false,\n  "operation": "createAccount|getBalance|transfer|callContract",\n  "params": {},\n  "confidence": 0.9\n}\n\n或者如果是一般聊天：\n{\n  "isMCP": false,\n  "confidence": 0.9\n}\n\n请只返回JSON格式，不要包含其他文字。`;
        try {
            console.log('[BitseekClient] 发送AI判断请求...');
            const response = await this.sendMessage(judgePrompt, streamCallback);
            console.log('[BitseekClient] AI判断响应:', response);
            const judgeResult = this.parseAIResponse(response, 'judge');
            console.log('[BitseekClient] 解析后的判断结果:', judgeResult);
            if (judgeResult && typeof judgeResult === 'object') {
                if (judgeResult.isMCP === true && judgeResult.operation) {
                    const validOperations = Object.values(this.MCP_OPERATIONS);
                    if (validOperations.includes(judgeResult.operation)) {
                        console.log('[BitseekClient] AI判断成功，操作类型:', judgeResult.operation);
                        return {
                            isMCP: true,
                            operation: judgeResult.operation,
                            params: judgeResult.params || {},
                            confidence: judgeResult.confidence || 0.8
                        };
                    } else {
                        console.log('[BitseekClient] AI判断的操作类型无效:', judgeResult.operation);
                    }
                } else if (judgeResult.isMCP === false) {
                    console.log('[BitseekClient] AI判断为一般聊天');
                    return {
                        isMCP: false,
                        confidence: judgeResult.confidence || 0.8
                    };
                }
            }
            throw new Error('AI判断结果格式无效');
        } catch (error) {
            console.error('[BitseekClient] AI判断失败:', error.message);
            throw error;
        }
    }

    // ==================== 智能处理 ====================
    async processSmartInput(userInput, streamCallback = null) {
        console.log('[BitseekClient] 开始处理智能输入:', userInput);
        try {
            const judgeResult = await this.aiJudgeOperation(userInput, streamCallback);
            console.log('[BitseekClient] AI判断成功，结果:', judgeResult);
            if (judgeResult.isMCP) {
                console.log('[BitseekClient] 判断为MCP操作，执行MCP操作');
                return await this.handleMCPOperation(judgeResult, userInput, streamCallback);
            }
            console.log('[BitseekClient] 判断为非MCP操作，直接进行聊天并流式显示');
            const chatResp = await this.sendMessage(userInput, streamCallback);
            return {
                type: 'chat',
                response: this.parseAIResponse(chatResp, 'general')
            };
        } catch (error) {
            console.error('[BitseekClient] processSmartInput 整体失败:', error.message);
            return {
                type: 'error',
                response: `处理失败: ${error.message}`
            };
        }
    }

    // ==================== MCP操作 ====================
    async handleMCPOperation(judgeObj, userInput, streamCallback = null) {
        console.log('[BitseekClient] 判断为MCP操作，开始执行...');
        let mcpResult;
        try {
            mcpResult = await this.retryWithBackoff(async () => {
                const result = await this.executeMCPOperation(judgeObj.operation, judgeObj.params);
                return this.validateMCPResult(result, judgeObj.operation);
            }, this.config.MAX_RETRIES, this.config.RETRY_DELAY);
            console.log('[BitseekClient] MCP操作执行成功，结果:', JSON.stringify(mcpResult, null, 2));
        } catch (err) {
            console.error('[BitseekClient] MCP操作失败:', err.message);
            return this.handleMCPError(err);
        }
        const summaryPrompt = `你是一个区块链助手。用户的问题: "${userInput}"
MCP接口返回的结果: ${JSON.stringify(mcpResult, null, 2)}

请根据用户的问题和MCP接口的返回结果，给用户一个清晰、友好的回复。回复应该：
1. 直接回答用户的问题
2. 如果操作成功，说明结果
3. 如果操作失败，解释原因
4. 使用简单易懂的语言
5. 不要包含技术细节，除非用户特别要求
6. 保持回复简洁明了`;
        let summaryResp;
        try {
            summaryResp = await this.sendMessage(summaryPrompt, streamCallback);
            console.log('[BitseekClient] AI总结响应完成');
        } catch (summaryError) {
            console.error('[BitseekClient] AI总结失败:', summaryError.message);
            summaryResp = `操作完成。结果: ${JSON.stringify(mcpResult, null, 2)}`;
        }
        return {
            type: 'mcp_operation',
            response: this.parseAIResponse(summaryResp, 'summary'),
            rawResult: mcpResult
        };
    }
    async executeMCPOperation(operation, params) {
        console.log('[BitseekClient] 执行MCP操作:', operation, '参数:', params);
        const mcpTimeout = this.config.MCP_TIMEOUT;
        return this.withTimeout(async () => {
            switch (operation) {
                case this.MCP_OPERATIONS.CREATE_ACCOUNT:
                    console.log('[BitseekClient] 执行创建账户操作');
                    return await this.mcpClient.createAccount();
                case this.MCP_OPERATIONS.GET_BALANCE:
                    if (!params.address) throw new Error('缺少地址参数');
                    console.log('[BitseekClient] 执行查询余额操作，地址:', params.address);
                    return await this.mcpClient.getBalance(params.address);
                case this.MCP_OPERATIONS.TRANSFER:
                    if (!params.senderPrivateKey || !params.recipient || !params.amount) throw new Error('缺少必要的转账参数');
                    console.log('[BitseekClient] 执行转账操作，接收方:', params.recipient, '金额:', params.amount);
                    return await this.mcpClient.transfer(params.senderPrivateKey, params.recipient, params.amount);
                case this.MCP_OPERATIONS.CALL_CONTRACT:
                    if (!params.privateKey || !params.packageObjectId || !params.module || !params.functionName) throw new Error('缺少必要的合约调用参数');
                    console.log('[BitseekClient] 执行合约调用操作:', {
                        packageObjectId: params.packageObjectId,
                        module: params.module,
                        functionName: params.functionName
                    });
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
        }, mcpTimeout);
    }
    validateMCPResult(result, operation) {
        console.log('[BitseekClient] 验证MCP操作结果:', operation);
        if (result === null || result === undefined) throw new Error('MCP操作返回空结果');
        if (typeof result === 'object') {
            if (result.error) throw new Error(`MCP操作失败: ${result.error}`);
            if (result.status && result.status !== 'success') throw new Error(`MCP操作状态异常: ${result.status}`);
        }
        console.log('[BitseekClient] MCP操作结果验证通过');
        return result;
    }
    handleMCPError(err) {
        if (err.message.includes('Network Error') || err.message.includes('timeout') || err.message.includes('ECONNREFUSED') || err.message.includes('无法连接到MCP服务器')) {
            const errorResponse = `🔧 MCP服务器连接失败\n\n` +
                `📋 问题诊断：\n` +
                `• MCP服务器未运行或无法访问\n` +
                `• 服务器地址: ${this.mcpClient.baseURL}\n` +
                `• 错误详情: ${err.message}\n\n` +
                `💡 解决方案：\n` +
                `1. 启动MCP服务器\n` +
                `2. 检查服务器端口 (默认: 3000)\n` +
                `3. 确认网络连接正常\n` +
                `4. 检查防火墙设置\n\n` +
                `🔄 替代方案：\n` +
                `• 您可以继续使用聊天功能\n` +
                `• 或者稍后重试MCP操作`;
            return { type: 'error', response: errorResponse };
        }
        if (err.message.includes('超时')) {
            const timeoutResponse = `⏰ MCP操作超时\n\n` +
                `📋 问题诊断：\n` +
                `• MCP操作执行时间过长\n` +
                `• 可能是网络延迟或服务器负载过高\n` +
                `• 错误详情: ${err.message}\n\n` +
                `💡 解决方案：\n` +
                `1. 检查网络连接\n` +
                `2. 稍后重试操作\n` +
                `3. 联系管理员检查服务器状态\n\n` +
                `🔄 替代方案：\n` +
                `• 您可以继续使用聊天功能\n` +
                `• 或者稍后重试MCP操作`;
            return { type: 'error', response: timeoutResponse };
        }
        return { type: 'error', response: `MCP 操作失败: ${err.message}` };
    }
    async retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
        console.log('[BitseekClient] 开始重试机制，最大重试次数:', maxRetries, '初始延迟:', initialDelay, 'ms');
        let retries = 0;
        let delay = initialDelay;
        while (retries < maxRetries) {
            try {
                console.log('[BitseekClient] 执行操作，重试次数:', retries);
                const result = await fn();
                if (result === null || result === undefined) throw new Error('操作返回空结果');
                console.log('[BitseekClient] 操作成功，结果类型:', typeof result);
                return result;
            } catch (error) {
                retries++;
                console.error(`[BitseekClient] 操作失败 (${retries}/${maxRetries}):`, error.message);
                if (retries === maxRetries) {
                    console.error('[BitseekClient] 达到最大重试次数，抛出错误');
                    throw error;
                }
                console.log(`[BitseekClient] ${delay}ms后重试... (${retries}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
            }
        }
    }
}

module.exports = BitseekClient;
