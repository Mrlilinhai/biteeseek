# DeepseekClient 智能查询系统

这是一个集成了 MCP (Model Context Protocol) 操作和大语言模型的智能查询系统。用户可以通过自然语言输入来执行区块链操作，系统会自动识别操作类型，调用相应的 MCP 服务，然后通过大模型整理结果后返回给用户。

## 功能特性

- **智能操作识别**: 自动识别用户输入中的区块链操作（创建账户、查询余额、转账、合约调用）
- **MCP 集成**: 无缝集成 MCP 客户端，执行实际的区块链操作
- **AI 结果整理**: 使用大语言模型将技术性的操作结果转换为用户友好的自然语言回复
- **多语言支持**: 支持中文和英文输入
- **参数自动提取**: 从用户输入中自动提取操作参数（地址、金额等）

## 支持的操作

### 1. 创建账户
- **输入示例**: 
  - "创建账户"
  - "创建账号"
  - "create account"
- **功能**: 创建新的区块链账户，返回地址和私钥

### 2. 查询余额
- **输入示例**:
  - "查询余额 0x1234567890123456789012345678901234567890"
  - "balance 0x1234567890123456789012345678901234567890"
- **功能**: 查询指定地址的账户余额

### 3. 转账
- **输入示例**:
  - "转账 100 到 0x1234567890123456789012345678901234567890"
  - "transfer 100 to 0x1234567890123456789012345678901234567890"
- **功能**: 执行代币转账操作

### 4. 合约调用
- **输入示例**:
  - "调用合约"
  - "call contract"
- **功能**: 调用智能合约（需要提供详细参数）

## 安装和配置

### 1. 安装依赖
```bash
npm install axios dotenv
```

### 2. 环境变量配置
创建 `.env` 文件并配置以下变量：
```env
DEEPSEEK_API_KEY=your_deepseek_api_key
MCP_SERVER_URL=http://localhost:3000
```

### 3. 启动 MCP 服务器
确保 MCP 服务器正在运行，默认地址为 `http://localhost:3000`

## 使用方法

### 基本使用
```javascript
const DeepseekClient = require('./deepseek-client');

const client = new DeepseekClient();

// 智能查询
const result = await client.processSmartQuery("创建账户");
if (result.success) {
    console.log(result.response); // AI 整理后的友好回复
    console.log(result.rawResult); // 原始 MCP 操作结果
} else {
    console.error(result.error);
}
```

### 运行测试
```bash
node test-smart-query.js
```

## API 参考

### DeepseekClient 类

#### 构造函数
```javascript
new DeepseekClient(apiKey, baseURL)
```
- `apiKey`: Deepseek API 密钥（可选，默认从环境变量读取）
- `baseURL`: Deepseek API 基础 URL（可选，默认为 'https://chat.bitseek.ai/api/v1'）

#### 主要方法

##### processSmartQuery(query)
智能处理用户查询，自动识别操作类型并执行。

**参数**:
- `query` (string): 用户输入的自然语言查询

**返回值**:
```javascript
{
    success: boolean,
    response?: string,        // AI 整理后的回复
    error?: string,          // 错误信息
    type: string,           // 操作类型
    rawResult?: object,     // 原始 MCP 操作结果
    needsAddress?: boolean, // 是否需要地址参数
    needsTransferInfo?: boolean, // 是否需要转账信息
    needsContractInfo?: boolean  // 是否需要合约信息
}
```

##### processMCPOperationWithAI(operation, params, originalQuery)
执行 MCP 操作并通过 AI 整理结果。

**参数**:
- `operation` (string): 操作类型
- `params` (object): 操作参数
- `originalQuery` (string): 原始用户查询

##### formatMCPResultWithAI(operation, mcpResult, originalQuery)
使用 AI 格式化 MCP 操作结果。

## 错误处理

系统提供详细的错误信息和用户友好的提示：

- **参数缺失**: 当操作需要参数但用户未提供时，会返回具体的提示信息
- **网络错误**: 自动检测网络连接问题
- **服务器错误**: 显示 MCP 服务器的具体错误信息
- **AI 格式化失败**: 如果 AI 格式化失败，会返回原始结果

## 示例输出

### 创建账户成功
```
✅ 成功
回复: 账户创建成功！您的账户地址是：0x1234567890123456789012345678901234567890

请务必安全保管您的私钥：0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890

接下来您可以：
1. 查询账户余额
2. 接收代币转账
3. 进行转账操作

请记住，私钥是访问您账户的唯一凭证，请妥善保管，不要泄露给任何人。
```

### 查询余额成功
```
✅ 成功
回复: 查询结果如下：

地址：0x1234567890123456789012345678901234567890
余额：1,000,000,000 SUI
单位：SUI (最小单位为 0.000000001 SUI)

您的账户余额充足，可以进行转账或其他操作。
```

## 注意事项

1. **私钥安全**: 创建账户时返回的私钥需要安全保管，不要泄露给他人
2. **网络连接**: 确保 MCP 服务器正常运行且网络连接正常
3. **API 限制**: 注意 Deepseek API 的调用频率限制
4. **参数格式**: 地址必须是有效的区块链地址格式
5. **金额单位**: 转账金额的单位需要根据具体区块链网络确定

## 故障排除

### 常见问题

1. **"Deepseek API 密钥未设置"**
   - 检查 `.env` 文件中的 `DEEPSEEK_API_KEY` 配置

2. **"网络连接失败"**
   - 检查 MCP 服务器是否正在运行
   - 确认 `MCP_SERVER_URL` 配置正确

3. **"缺少地址参数"**
   - 在查询余额时提供完整的地址
   - 确保地址格式正确

4. **"AI 响应格式无效"**
   - 检查 Deepseek API 服务状态
   - 确认 API 密钥有效

## 扩展功能

系统设计为可扩展的，可以轻松添加新的操作类型：

1. 在 `parseMCPOperation` 方法中添加新的操作识别逻辑
2. 在 `processMCPOperationWithAI` 方法中添加新的操作处理
3. 在 `formatMCPResultWithAI` 方法中添加新的结果格式化逻辑
4. 在 MCP 客户端中添加相应的操作方法

websocket
node webScoket/bitseek-cli.js interactive

https
node cli.js chat