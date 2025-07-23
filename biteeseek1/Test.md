安装依赖
pnpm install

启动服务器
pnpm start

创建账户
curl http://localhost:3000/account/create

查询余额 
curl http://localhost:3000/balance/
0x0c8c4c522db577d70c1e9b390915a62bae5a66ed1809dcf2d573ebcd90c8f3ff
0xe3fdff4589af81e2ac707b06e6341c65ee513f9e301e17b5184253dcb754090a

转账
curl -X POST http://localhost:3000/transfer \-H "Content-Type: application/json" \-d '{  "senderPrivateKey": "suiprivkey1qpph54wv9z23mlksukh67hrlq5pe0rryg0t4gsfr7lft8y38f90q2gmlujy",  "recipient": "0x0c8c4c522db577d70c1e9b390915a62bae5a66ed1809dcf2d573ebcd90c8f3ff",  "amount": "100000000"}'


node cli.js chat



