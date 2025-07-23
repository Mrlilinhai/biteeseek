#!/usr/bin/env node

const DeepseekClient = require('./deepseek-client');
const { program } = require('commander');
const readline = require('readline');

program
    .version('1.0.0')
    .description('Deepseek MCP 命令行工具');

program
    .command('create-account')
    .description('创建新账户')
    .action(async () => {
        try {
            const client = new DeepseekClient();
            const result = await client.processMCPOperation('createAccount', {});
            console.log('账户创建成功:', result);
        } catch (error) {
            console.error('创建账户失败:', error.message);
        }
    });

program
    .command('get-balance <address>')
    .description('查询账户余额')
    .action(async (address) => {
        try {
            const client = new DeepseekClient();
            const result = await client.processMCPOperation('getBalance', { address });
            console.log('账户余额:', result);
        } catch (error) {
            console.error('查询余额失败:', error.message);
        }
    });

program
    .command('transfer <senderPrivateKey> <recipient> <amount>')
    .description('转账操作')
    .action(async (senderPrivateKey, recipient, amount) => {
        try {
            const client = new DeepseekClient();
            const result = await client.processMCPOperation('transfer', {
                senderPrivateKey,
                recipient,
                amount
            });
            console.log('转账成功:', result);
        } catch (error) {
            console.error('转账失败:', error.message);
        }
    });

program
    .command('call-contract <privateKey> <packageObjectId> <module> <functionName> [args...]')
    .description('调用智能合约')
    .action(async (privateKey, packageObjectId, module, functionName, args) => {
        try {
            const client = new DeepseekClient();
            const result = await client.processMCPOperation('callContract', {
                privateKey,
                packageObjectId,
                module,
                functionName,
                args: args || [],
                typeArguments: []
            });
            console.log('合约调用结果:', result);
        } catch (error) {
            console.error('合约调用失败:', error.message);
        }
    });

program
    .command('chat')
    .description('通过自然语言与 Deepseek 交互')
    .action(async () => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const beautifyOutput = (text, type = 'info') => {
            const colors = {
                info: '\x1b[36m',    // 青色
                success: '\x1b[32m',  // 绿色
                warning: '\x1b[33m',  // 黄色
                error: '\x1b[31m',    // 红色
                reset: '\x1b[0m'      // 重置
            };
            
            const icons = {
                info: 'ℹ️',
                success: '✅',
                warning: '⚠️',
                error: '❌'
            };
            
            return `${colors[type]}${icons[type]} ${text}${colors.reset}`;
        };

        const client = new DeepseekClient();
        console.log(beautifyOutput('欢迎使用 Deepseek MCP 聊天模式！', 'success'));
        console.log(beautifyOutput('输入 "exit" 退出', 'info'));
        console.log('');

        const parseAIResponse = (response) => {
            try {
                // 如果 response 是完整的 axios 响应对象
                if (response && response.data && response.data.outputs) {
                    return response.data.outputs;
                }
                
                // 如果 response 直接是字符串
                if (typeof response === 'string') {
                    return response;
                }
                
                // 如果 response 是对象但没有 outputs 字段
                if (response && typeof response === 'object') {
                    // 尝试从常见字段中提取内容
                    if (response.outputs) return response.outputs;
                    if (response.content) return response.content;
                    if (response.text) return response.text;
                    if (response.message) return response.message;
                    if (response.response) return response.response;
                    
                    // 如果是 JSON 字符串，尝试解析
                    if (response.data && typeof response.data === 'string') {
                        try {
                            const parsed = JSON.parse(response.data);
                            if (parsed.outputs) return parsed.outputs;
                            if (parsed.content) return parsed.content;
                            return parsed;
                        } catch (e) {
                            return response.data;
                        }
                    }
                    
                    // 如果都没有，返回整个对象
                    return JSON.stringify(response, null, 2);
                }
                
                // 如果 response 是其他类型，转换为字符串
                return String(response);
            } catch (error) {
                // 如果解析失败，尝试提取 JSON 部分
                const responseStr = String(response);
                const jsonMatch = responseStr.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        const parsed = JSON.parse(jsonMatch[0]);
                        if (parsed.outputs) return parsed.outputs;
                        if (parsed.content) return parsed.content;
                        return parsed;
                    } catch (e) {
                        // 如果 JSON 解析也失败，返回原始字符串
                        return responseStr;
                    }
                }
                
                // 最后返回原始响应的字符串形式
                return String(response);
            }
        };

        const formatAIResponse = (response) => {
            try {
                // 首先解析响应
                const parsedResponse = parseAIResponse(response);
                
                // 如果是字符串，进行格式化
                if (typeof parsedResponse === 'string') {
                    let formatted = parsedResponse.trim();
                    
                    // 移除多余的换行符
                    formatted = formatted.replace(/\n{3,}/g, '\n\n');
                    
                    // 如果内容很长，添加分隔线
                    if (formatted.length > 200) {
                        formatted = '\n' + '─'.repeat(50) + '\n' + formatted + '\n' + '─'.repeat(50);
                    }
                    
                    return formatted;
                }
                
                // 如果是对象，格式化为 JSON
                if (typeof parsedResponse === 'object') {
                    return JSON.stringify(parsedResponse, null, 2);
                }
                
                return String(parsedResponse);
            } catch (error) {
                return String(response);
            }
        };

        const processAIResponse = (response, context = 'general') => {
            try {
                const parsedResponse = parseAIResponse(response);
                
                // 根据上下文进行不同的处理
                switch (context) {
                    case 'judge':
                        if (typeof parsedResponse === 'string') {
                            // 尝试提取第一个以 { 开头的完整 JSON，并自动补全右大括号
                            const start = parsedResponse.indexOf('{');
                            if (start !== -1) {
                                for (let end = start + 1; end <= parsedResponse.length; end++) {
                                    const candidate = parsedResponse.slice(start, end);
                                    try {
                                        return JSON.parse(candidate);
                                    } catch (e) {
                                        // 继续补字符，直到能 parse
                                    }
                                }
                            }
                            throw new Error('未找到完整 JSON 格式内容');
                        }
                        return parsedResponse;
                        
                    case 'summary':
                        // 总结性回复，需要格式化显示
                        return formatAIResponse(parsedResponse);
                        
                    case 'error':
                        // 错误信息，需要突出显示
                        const errorMsg = typeof parsedResponse === 'string' ? parsedResponse : JSON.stringify(parsedResponse);
                        return `❌ 错误: ${errorMsg}`;
                        
                    case 'success':
                        // 成功信息，需要美化显示
                        const successMsg = typeof parsedResponse === 'string' ? parsedResponse : JSON.stringify(parsedResponse);
                        return `✅ ${successMsg}`;
                        
                    default:
                        // 一般聊天回复
                        return formatAIResponse(parsedResponse);
                }
            } catch (error) {
                return `处理响应时出错: ${error.message}`;
            }
        };

        const showLoading = (message) => {
            const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
            let i = 0;
            const interval = setInterval(() => {
                process.stdout.write(`\r${frames[i]} ${message}`);
                i = (i + 1) % frames.length;
            }, 80);
            return interval;
        };

        const stopLoading = (interval) => {
            clearInterval(interval);
            process.stdout.write('\r' + ' '.repeat(50) + '\r'); // 清除加载动画
        };

        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // 本地关键词判断函数（备用方案）
        const localJudgeOperation = (input) => {
            const lowerInput = input.toLowerCase();
            
            // 创建账户相关关键词
            if (lowerInput.includes('创建') && (lowerInput.includes('账户') || lowerInput.includes('账号') || lowerInput.includes('钱包'))) {
                return { isMCP: true, operation: 'createAccount', params: {} };
            }
            if (lowerInput.includes('create') && lowerInput.includes('account')) {
                return { isMCP: true, operation: 'createAccount', params: {} };
            }
            
            // 查询余额相关关键词
            if (lowerInput.includes('余额') || lowerInput.includes('查余额') || lowerInput.includes('查询余额')) {
                return { isMCP: true, operation: 'getBalance', params: {} };
            }
            if (lowerInput.includes('balance')) {
                return { isMCP: true, operation: 'getBalance', params: {} };
            }
            
            // 转账相关关键词
            if (lowerInput.includes('转账') || lowerInput.includes('转钱') || lowerInput.includes('发送')) {
                return { isMCP: true, operation: 'transfer', params: {} };
            }
            if (lowerInput.includes('transfer')) {
                return { isMCP: true, operation: 'transfer', params: {} };
            }
            
            // 合约相关关键词
            if (lowerInput.includes('合约') || lowerInput.includes('调用合约')) {
                return { isMCP: true, operation: 'callContract', params: {} };
            }
            if (lowerInput.includes('contract')) {
                return { isMCP: true, operation: 'callContract', params: {} };
            }
            
            // 默认不是 MCP 操作
            return { isMCP: false };
        };

        const retryWithBackoff = async (fn, maxRetries = 3, initialDelay = 1000) => {
            let retries = 0;
            let delay = initialDelay;
            let abortController = new AbortController();

            // 设置中断处理
            const handleInterrupt = () => {
                abortController.abort();
                console.log('\n操作已中断');
                process.exit(0);
            };

            process.on('SIGINT', handleInterrupt);

            try {
                while (retries < maxRetries) {
                    try {
                        return await fn();
                    } catch (error) {
                        if (abortController.signal.aborted) {
                            throw new Error('操作被用户中断');
                        }

                        retries++;
                        if (retries === maxRetries) {
                            throw error;
                        }

                        console.log(`\n请求失败，${maxRetries - retries} 秒后重试...`);
                        console.log('按 Ctrl+C 可以中断重试');
                        await sleep(delay);
                        delay *= 2; // 指数退避
                    }
                }
            } finally {
                process.removeListener('SIGINT', handleInterrupt);
            }
        };

        const askQuestion = () => {
            rl.question('请输入您的指令: ', async (input) => {
                if (input.toLowerCase() === 'exit') {
                    console.log(beautifyOutput('感谢使用，再见！', 'success'));
                    rl.close();
                    return;
                }

                try {
                    // 1. 先用 AI 判断是否为 MCP 操作
                    const loadingInterval = showLoading('AI 正在思考中... (按 Ctrl+C 中断)');
                    
                    // 更明确的 prompt，强制要求 JSON 格式
                    const judgePrompt = `你是一个区块链助手，请判断用户输入是否为区块链相关操作指令（如创建账号、余额查询、转账、调用合约等），\n无论用户表达是否委婉或间接（如“请帮我创建账号指令”“帮我查下余额”“我想转账给xxx”），\n都要识别出来并返回 JSON：{"isMCP":true, "operation":"操作名称", "params":{参数对象}}。\noperation 字段必须严格使用如下英文标识（不要用中文）：\n- createAccount\n- getBalance\n- transfer\n- callContract\n如果不是相关操作，返回 {"isMCP":false}。\n常见表达示例：\n- 创建账号：如“创建账号”“帮我创建账号”“请帮我创建账号指令”，operation 应为 createAccount\n- 查询余额：如“查余额”“帮我查下余额”“请查询我的余额”，operation 应为 getBalance\n- 转账：如“我要转账”“帮我转账给xxx 100元”，operation 应为 transfer\n- 调用合约：如“调用合约xxx”“帮我执行xxx合约”，operation 应为 callContract\n请严格返回 JSON 格式。`;

                    const aiJudge = await retryWithBackoff(async () => {
                        return await client.generateResponse(`${judgePrompt}\n用户输入: ${input}`);
                    });
                    
                    // 添加调试信息
                    // console.log('\n[DEBUG] AI 原始响应:', aiJudge);
                    
                    let judgeObj;
                    try {
                        judgeObj = processAIResponse(aiJudge, 'judge');
                        console.log('[DEBUG] 解析后的判断结果:', judgeObj);
                    } catch (e) {
                        stopLoading(loadingInterval);
                        console.error('\nAI 判断格式不正确:', e.message);
                        // 只要解析失败，直接 fallback 到本地关键词判断
                        judgeObj = localJudgeOperation(input);
                        console.log('[DEBUG] 使用本地判断:', judgeObj);
                    }
                    stopLoading(loadingInterval);

                    if (!judgeObj.isMCP) {
                        // 闲聊，直接用 Deepseek 聊天
                        const chatLoading = showLoading('Deepseek 正在回复...');
                        const chatResp = await retryWithBackoff(async () => {
                            return await client.generateResponse(input);
                        });
                        stopLoading(chatLoading);
                        console.log('\nDeepseek:', processAIResponse(chatResp, 'general'));
                        askQuestion();
                        return;
                    }

                    // 是 MCP 操作，先执行接口
                    let mcpResult;
                    try {
                        const executingInterval = showLoading('正在执行区块链操作... (按 Ctrl+C 中断)');
                        mcpResult = await retryWithBackoff(async () => {
                            return await client.processMCPOperation(judgeObj.operation, judgeObj.params);
                        });
                        stopLoading(executingInterval);
                    } catch (err) {
                        console.error('\nMCP 操作失败:', err.message);
                        askQuestion();
                        return;
                    }

                    // 把接口结果和原始问题交给 Deepseek 整理
                    const summaryLoading = showLoading('Deepseek 正在整理结果...');
                    const summaryPrompt = `User question: ${input}\nInterface return: ${JSON.stringify(mcpResult)}\nPlease reply to the user in a concise and clear way.`;
                    const summaryResp = await retryWithBackoff(async () => {
                        return await client.generateResponse(summaryPrompt);
                    });
                    stopLoading(summaryLoading);
                    console.log('\nDeepseek:', processAIResponse(summaryResp, 'summary'));
                } catch (error) {
                    if (error.message === '操作被用户中断') {
                        console.log('\n操作已被中断');
                        return;
                    }
                    console.error('\n处理失败:', processAIResponse(error.message, 'error'));
                    if (error.message.includes('aborted')) {
                        console.log('网络连接不稳定，请检查网络连接后重试');
                    }
                }

                console.log('\n');
                askQuestion();
            });
        };

        askQuestion();
    });

program.parse(process.argv);
