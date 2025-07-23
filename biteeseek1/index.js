const express = require('express');
const { getFullnodeUrl, SuiClient } = require('@mysten/sui/client');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { fromB64, fromB58 } = require('@mysten/sui/utils');
const { Transaction } = require('@mysten/sui/transactions');
const bip39 = require('bip39');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

// Sui节点RPC地址（可根据需要更换）
const SUI_RPC_URL = 'https://rpc-testnet.suiscan.xyz:443';
const client = new SuiClient({ url: SUI_RPC_URL });

// 查询Sui账户余额
app.get('/balance/:address', async (req, res) => {
  const address = req.params.address;
  console.log(`[请求] /balance/:address`, { address });
  try {
    const coins = await client.getCoins({ owner: address });
    const total = coins.data.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);
    const result = { address, balance: total.toString() };
    console.log(`[响应] /balance/:address`, result);
    res.json(result);
  } catch (err) {
    console.error(`[错误] /balance/:address`, err);
    res.status(500).json({ error: err.message });
  }
});

// 查询Sui账户SUI余额（单位：MIST）
app.get('/balance/sui/:address', async (req, res) => {
  const address = req.params.address;
  console.log(`[请求] /balance/sui/:address`, { address });
  try {
    const balance = await client.getBalance({ owner: address });
    const result = { address, balance };
    console.log(`[响应] /balance/sui/:address`, result);
    res.json(result);
  } catch (err) {
    console.error(`[错误] /balance/sui/:address`, err);
    res.status(500).json({ error: err.message });
  }
});

// 创建Sui账号
app.get('/account/create', async (req, res) => {
  console.log(`[请求] /account/create`);
  try {
    const mnemonic = bip39.generateMnemonic();
    const keypair = Ed25519Keypair.deriveKeypair(mnemonic);
    const address = keypair.getPublicKey().toSuiAddress();
    const result = {
      mnemonic,
      address,
      publicKey: keypair.getPublicKey().toBase64(),
      privateKey: Buffer.from(keypair.getSecretKey()).toString('base64')
    };
    console.log(`[响应] /account/create`, result);
    res.json(result);
  } catch (err) {
    console.error(`[错误] /account/create`, err);
    res.status(500).json({ error: err.message });
  }
});

// Sui转账
app.post('/transfer', express.json(), async (req, res) => {
  const { senderPrivateKey, recipient, amount } = req.body;
  console.log(`[请求] /transfer`, { recipient, amount }); // 避免在日志中直接输出私钥

  try {
    console.log('[转账流程] 开始处理转账请求');

    // 1. 从 Sui 序列化私钥字符串创建 Keypair
    console.log('[转账流程] 尝试直接从 Sui 序列化私钥字符串创建 Keypair');
    // 根据 Sui SDK 文档，Ed25519Keypair.fromSecretKey 可以直接处理以 'suiprivkey' 开头的 Base58 编码字符串
    const keypair = Ed25519Keypair.fromSecretKey(senderPrivateKey);
    console.log('[转账流程] Keypair 创建成功');

    // 2. 获取发送方地址
    const sender = keypair.getPublicKey().toSuiAddress();
    console.log(`[转账流程] 发送方地址: ${sender}`);
    console.log(`[转账流程] 接收方地址: ${recipient}`);
    console.log(`[转账流程] 转账金额 (MIST): ${amount}`);


    // 3. 检查发送方 Gas Coin (SUI) 余额
    console.log(`[转账流程] 检查发送方 (${sender}) 的 Gas Coin 余额`);
    const coins = await client.getCoins({ owner: sender, coinType: '0x2::sui::SUI' }); // Explicitly check for SUI coin
    if (!coins.data || coins.data.length === 0) {
      throw new Error('发送方无 SUI 余额，无法支付 Gas。');
    }
     console.log(`[转账流程] 发送方有 ${coins.data.length} 个 Gas Coin`);


    // 4. 构建交易块
    console.log('[转账流程] 构建交易块');
    const tx = new Transaction();

    // 将 Gas Coin 拆分成指定金额和剩余部分
    // BigInt() 可以处理字符串形式的数字，包括 '0'
    const [coin] = tx.splitCoins(tx.gas, [BigInt(amount)]);
    console.log(`[转账流程] 拆分 Gas Coin，金额: ${amount}`);

    // 转移拆分出的 Coin 给接收方
    tx.transferObjects([coin], recipient);
    console.log(`[转账流程] 添加转移对象指令: 将拆分出的 Coin 转移给 ${recipient}`);


    // 5. 签名并执行交易
    console.log('[转账流程] 签名并执行交易块');
    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true, showEvents: true }
    }); // 添加 options 以查看更多执行结果详情
    console.log('[转账流程] 交易执行完成');
    console.log(`[响应] /transfer`, result);

    // 6. 返回交易结果
    res.json({ sender, recipient, amount, tx: result });

  } catch (err) {
    console.error(`[错误] /transfer`, err);
    res.status(500).json({ error: err.message });
  }
});

// 部署代币合约
app.post('/token/deploy', express.json(), async (req, res) => {
  const { privateKey } = req.body;
  console.log(`[请求] /token/deploy`);

  try {
    // 1. 创建 Keypair
    const keypair = Ed25519Keypair.fromSecretKey(privateKey);
    const sender = keypair.getPublicKey().toSuiAddress();

    // 2. 读取合约文件
    const contractPath = path.join(__dirname, 'contracts/MyToken.move');
    const contractCode = fs.readFileSync(contractPath, 'utf8');

    // 3. 构建发布交易
    const tx = new Transaction();
    tx.publish({
      modules: [contractCode],
      dependencies: []
    });

    // 4. 签名并执行交易
    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true, showEvents: true }
    });

    console.log(`[响应] /token/deploy`, result);
    res.json({ 
      sender,
      result,
      packageId: result.effects.created[0].reference.objectId
    });

  } catch (err) {
    console.error(`[错误] /token/deploy`, err);
    res.status(500).json({ error: err.message });
  }
});

// 铸造代币
app.post('/token/mint', express.json(), async (req, res) => {
  const { privateKey, packageId, treasuryCapId, recipient, amount } = req.body;
  console.log(`[请求] /token/mint`, { packageId, treasuryCapId, recipient, amount });

  try {
    // 1. 创建 Keypair
    const keypair = Ed25519Keypair.fromSecretKey(privateKey);
    const sender = keypair.getPublicKey().toSuiAddress();

    // 2. 构建铸造交易
    const tx = new Transaction();
    tx.moveCall({
      target: `${packageId}::my_token::mint_token`,
      arguments: [
        tx.object(treasuryCapId),
        tx.pure('u64', amount),
        // 注意：mint_token 函数不需要 recipient 参数，它会自动发送给调用者
      ]
    });

    // 3. 签名并执行交易
    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true, showEvents: true }
    });

    console.log(`[响应] /token/mint`, result);
    res.json({ sender, recipient, amount, result });

  } catch (err) {
    console.error(`[错误] /token/mint`, err);
    res.status(500).json({ error: err.message });
  }
});

// 使用Sui原生功能创建代币
app.post('/token/create', express.json(), async (req, res) => {
  const { privateKey, name, symbol, decimals, description, url } = req.body;
  console.log(`[请求] /token/create`, { name, symbol, decimals });

  try {
    // 验证输入
    if (!name || !symbol || decimals === undefined) {
      throw new Error('缺少必要参数：name, symbol, decimals');
    }

    // 1. 创建 Keypair
    let keypair;
    if (privateKey.startsWith('suiprivkey')) {
      // 处理 suiprivkey 格式的私钥
      const decodedKey = fromB58(privateKey);
      keypair = Ed25519Keypair.fromSecretKey(decodedKey);
    } else {
      // 处理 base64 格式的私钥
      keypair = Ed25519Keypair.fromSecretKey(privateKey);
    }
    const sender = keypair.getPublicKey().toSuiAddress();

    // 2. 构建创建代币交易
    const tx = new Transaction();
    tx.moveCall({
      target: '0x2::coin::create_currency',
      typeArguments: [],
      arguments: [
        tx.pure('vector<u8>', Array.from(Buffer.from(name))),
        tx.pure('vector<u8>', Array.from(Buffer.from(symbol))),
        tx.pure('u8', Number(decimals)),
        tx.pure('vector<u8>', Array.from(Buffer.from(description || ''))),
        tx.pure('vector<u8>', Array.from(Buffer.from(url || '')))
      ]
    });

    // 3. 签名并执行交易
    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true, showEvents: true }
    });

    console.log(`[响应] /token/create`, result);
    res.json({ 
      sender,
      result,
      // 从结果中提取代币类型
      tokenType: result.effects.created[0].reference.objectId
    });

  } catch (err) {
    console.error(`[错误] /token/create`, err);
    res.status(500).json({ error: err.message });
  }
});

// 自定义代币转账
app.post('/token/transfer', express.json(), async (req, res) => {
  const { privateKey, packageId, coinType, senderCoinId, recipient, amount } = req.body;
  // coinType 例：0xe65d6dabc45f6e6c04f39ae356286b205d363792fedd947e314827dbdefa772e::my_token::MY_TOKEN
  try {
    const keypair = Ed25519Keypair.fromSecretKey(privateKey);
    const sender = keypair.getPublicKey().toSuiAddress();
    const tx = new Transaction();
    // 1. 拆分自定义币
    const [coin] = tx.splitCoins(tx.object(senderCoinId), [BigInt(amount)]);
    // 2. 转账
    tx.transferObjects([coin], recipient);
    // 3. 执行
    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true, showEvents: true }
    });
    res.json({ sender, recipient, amount, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 根路径处理
app.get('/', (req, res) => {
  // 设置SSE所需的响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 发送初始数据
  const data = {
    status: 'success',
    message: 'MCP Sui Server is running',
    version: '1.0.0',
    endpoints: [
      { method: 'GET', path: '/balance/:address', description: '查询Sui账户余额' },
      { method: 'GET', path: '/balance/sui/:address', description: '查询Sui账户SUI余额（单位：MIST）' },
      { method: 'GET', path: '/account/create', description: '创建Sui账号' },
      { method: 'POST', path: '/transfer', description: 'Sui转账' },
      { method: 'POST', path: '/token/deploy', description: '部署代币合约' },
      { method: 'POST', path: '/token/mint', description: '铸造代币' },
      { method: 'POST', path: '/token/create', description: '使用Sui原生功能创建代币' },
      { method: 'POST', path: '/token/transfer', description: '自定义代币转账' }
    ]
  };

  // 发送格式化的SSE数据
  res.write(`event: init\ndata: ${JSON.stringify(data)}\n\n`);

  // 保持连接打开
  const keepAlive = setInterval(() => {
    res.write(':\n\n');
  }, 15000);

  // 当客户端断开连接时清理
  req.on('close', () => {
    clearInterval(keepAlive);
  });
});

// 修改监听配置
app.listen(port, '0.0.0.0', () => {
  console.log(`MCPServer Sui模板已启动，端口：${port}`);
  console.log(`服务器地址：http://localhost:${port}`);
  console.log(`IPv4地址：http://127.0.0.1:${port}`);
  console.log(`IPv6地址：http://[::1]:${port}`);
}); 