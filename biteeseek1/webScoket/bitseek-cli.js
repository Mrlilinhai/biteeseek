#!/usr/bin/env node

const BitseekClient = require('./bitseek-client');
const { program } = require('commander');
const readline = require('readline');

// 连接管理器 - 管理WebSocket连接
class ConnectionManager {
    constructor() {
        this.client = null;
        this.isConnecting = false;
        this.connectionPromise = null;
        this.lastActivity = Date.now();
        this.idleTimeout = 20 * 60 * 1000;
        this.idleTimer = null;
    }
    async getClient() {
        if (this.client && this.client.connectionStatus === 'connected') {
            this.updateActivity();
            return this.client;
        }
        if (this.isConnecting && this.connectionPromise) {
            await this.connectionPromise;
            return this.client;
        }
        return await this.createConnection();
    }
    async createConnection() {
        if (this.isConnecting) return this.connectionPromise;
        this.isConnecting = true;
        this.connectionPromise = this._createConnection();
        try {
            const client = await this.connectionPromise;
            this.client = client;
            this.updateActivity();
            return client;
        } finally {
            this.isConnecting = false;
            this.connectionPromise = null;
        }
    }
    async _createConnection() {
        const client = new BitseekClient();
        await client.connect();
        client.ws.on('close', () => {
            console.log('WebSocket连接已关闭');
            this.client = null;
            this.stopIdleTimer();
        });
        return client;
    }
    updateActivity() {
        this.lastActivity = Date.now();
        this.resetIdleTimer();
    }
    resetIdleTimer() {
        this.stopIdleTimer();
        this.idleTimer = setTimeout(() => this.disconnectIdle(), this.idleTimeout);
    }
    stopIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }
    async disconnectIdle() {
        if (this.client && this.client.connectionStatus === 'connected') {
            console.log('连接空闲超时，正在断开...');
            this.client.disconnect();
            this.client = null;
        }
    }
    async disconnect() {
        this.stopIdleTimer();
        if (this.client) {
            this.client.disconnect();
            this.client = null;
        }
    }
}
const connectionManager = new ConnectionManager();

program
    .version('1.0.0')
    .description('Bitseek MCP 命令行工具');

// 美化输出
const beautifyOutput = (text, type = 'info') => {
    const colors = {
        info: '\x1b[36m', success: '\x1b[32m', warning: '\x1b[33m', error: '\x1b[31m', reset: '\x1b[0m'
    };
    const icons = {
        info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌'
    };
    return `${colors[type]}${icons[type]} ${text}${colors.reset}`;
};

// 显示帮助
const showHelp = () => {
    console.log('\n' + '='.repeat(60));
    console.log(beautifyOutput('Bitseek 智能交互模式', 'success'));
    console.log('='.repeat(60));
    console.log(beautifyOutput('支持的功能：', 'info'));
    console.log('📝 区块链操作：');
    console.log('   • 创建账户：创建账号、帮我创建账号');
    console.log('   • 查询余额：查余额、帮我查下余额');
    console.log('   • 转账操作：转账给xxx、帮我转账');
    console.log('   • 合约调用：调用合约、执行合约');
    console.log('💬 自然对话：');
    console.log('   • 一般聊天、问题咨询、技术支持');
    console.log('🔧 特殊命令：');
    console.log('   • help - 显示帮助信息');
    console.log('   • exit - 退出程序');
    console.log('   • clear - 清屏');
    console.log('   • status - 显示连接状态');
    console.log('='.repeat(60));
    console.log(beautifyOutput('工作流程：', 'info'));
    console.log('1. 非MCP操作 → 直接启动聊天模式');
    console.log('2. MCP操作 → 执行操作后分析结果返回');
    console.log('='.repeat(60));
};

// 显示加载动画
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
    process.stdout.write('\r' + ' '.repeat(50) + '\r');
};
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 重试机制
const retryWithBackoff = async (fn, maxRetries = 5, initialDelay = 1000) => {
    let retries = 0, delay = initialDelay;
    let abortController = new AbortController();
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
                if (abortController.signal.aborted) throw new Error('操作被用户中断');
                retries++;
                if (retries === maxRetries) throw error;
                console.log(`\n请求失败，${delay}ms后重试... (${retries}/${maxRetries})`);
                console.log('按 Ctrl+C 可以中断重试');
                await sleep(delay);
                delay *= 1.5;
            }
        }
    } finally {
        process.removeListener('SIGINT', handleInterrupt);
    }
};

// 流式响应处理
let hasStreamDisplay = false;
let lastStreamContent = '';
const handleStreamResponse = (message) => {
    if (!hasStreamDisplay) {
        hasStreamDisplay = true;
        process.stdout.write('\n' + beautifyOutput('Bitseek:', 'success') + '\n');
    }
    process.stdout.write(message + '\n'); // 每次都换行追加
    lastStreamContent += message;
};

// 命令处理
const handleSpecialCommand = async (cmd, rl) => {
    switch (cmd) {
        case 'exit':
            console.log(beautifyOutput('正在关闭连接...', 'info'));
            await connectionManager.disconnect();
            console.log(beautifyOutput('感谢使用，再见！', 'success'));
            rl.close();
            return true;
        case 'help':
            showHelp();
            console.log('\n');
            return false;
        case 'clear':
            console.clear();
            showHelp();
            console.log('\n');
            return false;
        case 'status':
            const status = connectionManager.client ? connectionManager.client.connectionStatus : 'disconnected';
            console.log(beautifyOutput(`连接状态: ${status}`, 'info'));
            if (connectionManager.client) {
                const idleTime = Math.floor((Date.now() - connectionManager.lastActivity) / 1000);
                console.log(beautifyOutput(`最后活动: ${idleTime}秒前`, 'info'));
            }
            console.log('\n');
            return false;
        default:
            return null;
    }
};

// 主交互循环
const askQuestion = (rl) => {
    rl.question(beautifyOutput('Bitseek > ', 'info'), async (input) => {
        const trimmedInput = input.trim();
        if (!trimmedInput) {
            console.log(beautifyOutput('请输入您的指令', 'warning'));
            console.log('\n');
            return askQuestion(rl);
        }
        const special = await handleSpecialCommand(trimmedInput.toLowerCase(), rl);
        if (special === true) return;
        if (special === false) return askQuestion(rl);
        try {
            const loadingInterval = showLoading('Bitseek 正在处理中...');
            hasStreamDisplay = false;
            lastStreamContent = '';
            const client = await connectionManager.getClient();
            const result = await retryWithBackoff(() => client.processSmartInput(trimmedInput, handleStreamResponse));
            stopLoading(loadingInterval);
            if (!hasStreamDisplay) {
                console.log('\n' + beautifyOutput('Bitseek:', 'success') + ' ' + result.response);
            } else {
                console.log('');
            }
            if (result.type === 'mcp_operation' && process.env.DEBUG && result.rawResult) {
                console.log('\n' + beautifyOutput('[DEBUG] 原始结果:', 'info'));
                console.log(JSON.stringify(result.rawResult, null, 2));
            }
            if (result.type === 'error') {
                console.log('\n' + beautifyOutput('错误:', 'error') + ' ' + result.response);
            }
        } catch (error) {
            if (error.message === '操作被用户中断') {
                console.log('\n' + beautifyOutput('操作已被中断', 'warning'));
                return;
            }
            console.error('\n' + beautifyOutput('处理失败:', 'error') + ' ' + error.message);
            if (error.message.includes('aborted')) {
                console.log(beautifyOutput('网络连接不稳定，请检查网络连接后重试', 'warning'));
            }
        }
        console.log('\n');
        askQuestion(rl);
    });
};

// 交互命令
program
    .command('interactive')
    .description('智能交互模式 - 支持区块链操作和自然对话')
    .action(async () => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        process.on('SIGINT', async () => {
            console.log('\n' + beautifyOutput('正在关闭连接...', 'info'));
            await connectionManager.disconnect();
            process.exit(0);
        });
        process.on('SIGTERM', async () => {
            console.log('\n' + beautifyOutput('正在关闭连接...', 'info'));
            await connectionManager.disconnect();
            process.exit(0);
        });
        showHelp();
        console.log('\n');
        askQuestion(rl);
    });

program.parse(process.argv);