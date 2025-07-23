const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const MCPClient = require("./mcpclient");

const server = new McpServer({ name: "biteeseek", version: "1.0.0" });
const mcpClient = new MCPClient();

server.tool(
  "create_account",
  "创建新账户",
  {},
  async () => {
    try {
      const result = await mcpClient.createAccount();
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `创建账户失败: ${e.message}` }] };
    }
  }
);

server.tool(
  "get_balance",
  "查询账户余额",
  { address: z.string() },
  async ({ address }) => {
    try {
      const result = await mcpClient.getBalance(address);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `查询余额失败: ${e.message}` }] };
    }
  }
);

server.tool(
  "transfer",
  "转账操作",
  {
    senderPrivateKey: z.string(),
    recipient: z.string(),
    amount: z.string(),
  },
  async ({ senderPrivateKey, recipient, amount }) => {
    try {
      const result = await mcpClient.transfer(senderPrivateKey, recipient, amount);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `转账失败: ${e.message}` }] };
    }
  }
);

server.tool(
  "call_contract",
  "调用智能合约",
  {
    privateKey: z.string(),
    packageObjectId: z.string(),
    module: z.string(),
    functionName: z.string(),
    args: z.array(z.string()).optional(),
    typeArguments: z.array(z.string()).optional(),
  },
  async ({ privateKey, packageObjectId, module, functionName, args = [], typeArguments = [] }) => {
    try {
      if (!mcpClient.callContract) {
        return { content: [{ type: "text", text: "callContract 方法未实现" }] };
      }
      const result = await mcpClient.callContract(privateKey, packageObjectId, module, functionName, args, typeArguments);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `合约调用失败: ${e.message}` }] };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Biteeseek MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
}); 