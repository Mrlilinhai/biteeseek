module mycoin::mycoin {
    use sui::coin::{Self, Coin};
    use sui::tx_context::{Self, TxContext};
    use sui::balance;
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::error;
    use sui::event;

    /// 定义自定义Coin类型
    struct MYCOIN has store, drop, key {}

    /// 发行新币（mint），只能合约部署者调用
    public fun mint(recipient: address, amount: u64, ctx: &mut TxContext) {
        let coin = Coin::mint<MYCOIN>(amount, ctx);
        transfer::transfer(coin, recipient);
    }

    /// 获取Coin元数据（可选）
    public fun get_metadata(): (vector<u8>, vector<u8>, u8) {
        // 名称、符号、精度
        (b"My Coin", b"MYC", 9)
    }
}