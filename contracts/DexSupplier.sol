pragma solidity ^0.4.20;

import "./ERC20Interface.sol";
import "./BaseEx.sol";
import "./Withdrawable.sol";
import "./SupplierInterface.sol";


interface DexInterface{
    function getOffer(uint id) public constant returns(uint, ERC20, uint, ERC20);
    function sellAllAmount(ERC20 sendTkn, uint sendAmt, ERC20 getTkn, uint minFillAmount) public returns (uint fillAmt);
    function getBestOffer(ERC20 sellGem, ERC20 buyGem) public constant returns(uint);
}

contract WrapEther is ERC20{
    function deposit() public payable;
    function withdraw(uint amnt) public;
}

contract DexSupplier is SupplierInterface, Withdrawable, BaseEx
{
    struct Item
    {
        bool flag;
        uint key_idx;
    }

    uint constant internal MIN_TRADE_TOKEN_SRC_AMOUNT = (10**18);
    address public sanityRatesContract = address(0x00);
    address public mit;

    DexInterface dex;
    WrapEther wethToken;
    mapping(address => Item) items;
    address[] keys;
    mapping(address=>uint) minTradeTknSrcAmnt;
    bool public tradeEnabled;
    uint public feeBps;

    constructor(address _mit, DexInterface _dex, WrapEther _wrap, address _admin, uint _feeBps) public
    {
        require(_admin != address(0x00));
        require(_mit != address(0x00));
        require(_dex != address(0x00));
        require(_wrap != address(0x00));
        require(_feeBps < 10000);
        require(getDecimals(_wrap) == MAX_DECIMALS);

        mit = _mit;
        dex = _dex;
        wethToken = _wrap;
        feeBps = _feeBps;
        tradeEnabled = true;
        
        wethToken.approve(dex, 2**255);
    }

    function add(address value) internal returns (bool)
    {
        if (items[value].flag)
        {
            return false; // already there
        }
        
        items[value].flag = true;
        items[value].key_idx = keys.push(value)-1;
        return true;
    }

    function remove(address value) internal returns (bool)
    {
        if (!items[value].flag)
        {
            return false; // not there
        }

        uint rm_key_idx = items[value].key_idx;
        if (rm_key_idx < keys.length - 1)
        {
            address mv_key = keys[keys.length-1];
            keys[rm_key_idx] = mv_key;
            items[mv_key].key_idx = rm_key_idx;
        }
        keys.length--;

        delete items[value];
        return true;
    }

    function exists(address value) internal view returns (bool)
    {
        return items[value].flag;
    }

    function size() internal view returns (uint)
    {
        return keys.length;
    }

    function getKeys() internal view returns (address[])
    {
        return keys;
    }
    

    function () public payable
    {
        require(msg.sender == address(wethToken));
    }

    function trade(
        ERC20 src,
        uint srcAmnt,
        ERC20 dest,
        address destAddress,
        uint conversionRate,
        bool validate
    ) public payable returns(bool)
    {
        require(tradeEnabled, "the supplier trade disabled.");
        require(msg.sender == mit, "illegal msg sender");

        require(doTrade(src, srcAmnt, dest, destAddress, conversionRate, validate));

        return true;
    }

    event TradeEnabled(bool enable);
    function enableTrade() public onlyAdmin returns(bool){
        tradeEnabled = true;
        emit TradeEnabled(true);

        return true;
    }

    function disableTrade() public onlyOperator returns(bool){
        tradeEnabled = false;
        emit TradeEnabled(false);

        return true;
    }

    event resetMartletInstantlyTrader(address old, address _new);
    function setMartletInstantlyTrader(address _mit) public onlyAdmin{
        require(_mit != address(0x00));

        emit resetMartletInstantlyTrader(mit, _mit);
        mit = _mit;
    }

    event resetDex(address old, address _new);
    function setDexInterface(DexInterface _dex) public onlyAdmin{
        require(_dex != address(0x00));

        wethToken.approve(dex, 0);
        wethToken.approve(_dex, 0);
        address[] memory tokens = keys;
        for(uint i=0; i<tokens.length; i++)
        {
            ERC20(tokens[i]).approve(dex, 0);
            ERC20(tokens[i]).approve(_dex, 2**255);
        }

        emit resetDex(dex, _dex);
        dex = _dex;
    }

    event logSetTradeToken(address token, uint minAmnt, bool enable);
    function setTradeToken(ERC20 token, uint minAmnt, bool enable) public onlyAdmin{
        require((enable && !(exists(token))) || (!enable && exists(token)));

        if(enable){
            token.approve(dex, 2**255);
            require(add(token), "add token failed!");
            minTradeTknSrcAmnt[token] = minAmnt;
        }
        else{
            token.approve(dex, 0);
            require(remove(token), "remove token failed!");
            delete minTradeTknSrcAmnt[token];
        }

        emit logSetTradeToken(token, minAmnt, enable);
    }

    event resetFeeBps(uint old, uint _new);
    function setFeeBps(uint _feeBps) public onlyOperator{
        require(_feeBps < 10000);

        emit resetFeeBps(feeBps, _feeBps);
        feeBps = _feeBps;
    }

    function valueAfterReducingFee(uint val) public view returns(uint) {
        require(val <= MAX_QTY);
        return ((10000 - feeBps) * val) / 10000;
    }

    function valueBeforeFeesWereReduced(uint val) public view returns(uint) {
        require(val <= MAX_QTY);
        return val * 10000 / (10000 - feeBps);
    }


    function getConversionRate(ERC20 src, ERC20 dest, uint srcQty, uint blockNumber) public view returns(uint) {
        uint  rate;
        uint  actualSrcQty;
        ERC20 wrappedSrc;
        ERC20 wrappedDest;
        uint  bestOfferId;
        uint  offerPayAmt;
        uint  offerBuyAmt;

        blockNumber;

        if (!tradeEnabled) return 0;
        if (!exists(src) && !exists(dest)) return 0;

        if (src == ETH_TOKEN_ADDRESS) {
            wrappedSrc = wethToken;
            wrappedDest = dest;
            actualSrcQty = srcQty;
        } else if (dest == ETH_TOKEN_ADDRESS) {
            wrappedSrc = src;
            wrappedDest = wethToken;

            if (srcQty < minTradeTknSrcAmnt[src]) {
                actualSrcQty = minTradeTknSrcAmnt[src];
            } else {
                actualSrcQty = srcQty;
            }
        } else {
            return 0;
        }

        // getBestOffer's terminology is of offer maker, so their sellGem is our (the taker's) dest token.
        bestOfferId = dex.getBestOffer(wrappedDest, wrappedSrc);
        (offerPayAmt, , offerBuyAmt,) = dex.getOffer(bestOfferId);

        // make sure to take only first level of order book to avoid gas inflation.
        if (actualSrcQty > offerBuyAmt) return 0;

        rate = calcRateFromQty(offerBuyAmt, offerPayAmt, MAX_DECIMALS, MAX_DECIMALS);
        return valueAfterReducingFee(rate);
    }

    event TradeExecute(
        address indexed sender,
        address src,
        uint srcAmount,
        address destToken,
        uint destAmount,
        address destAddress
    );
    function doTrade(
        ERC20 srcToken,
        uint srcAmount,
        ERC20 destToken,
        address destAddress,
        uint conversionRate,
        bool validate
    )
        internal
        returns(bool)
    {
        require((ETH_TOKEN_ADDRESS == srcToken) || (ETH_TOKEN_ADDRESS == destToken));
        require(exists(srcToken) || exists(destToken));

        uint actualDestAmount;

        // can skip validation if done at kyber network level
        if (validate) {
            require(conversionRate > 0);
            if (srcToken == ETH_TOKEN_ADDRESS)
                require(msg.value == srcAmount);
            else
                require(msg.value == 0);
        }

        uint userExpectedDestAmount = calcDstQty(srcAmount, MAX_DECIMALS, MAX_DECIMALS, conversionRate);
        require(userExpectedDestAmount > 0); // sanity check

        uint destAmountIncludingFees = valueBeforeFeesWereReduced(userExpectedDestAmount);

        if (srcToken == ETH_TOKEN_ADDRESS) {
            wethToken.deposit.value(msg.value)();

            actualDestAmount = dex.sellAllAmount(wethToken, msg.value, destToken, destAmountIncludingFees);
            require(actualDestAmount >= destAmountIncludingFees);

            // transfer back only requested dest amount.
            require(destToken.transfer(destAddress, userExpectedDestAmount));
        } else {
            require(srcToken.transferFrom(msg.sender, this, srcAmount));
 
            actualDestAmount = dex.sellAllAmount(srcToken, srcAmount, wethToken, destAmountIncludingFees);
            require(actualDestAmount >= destAmountIncludingFees);
            wethToken.withdraw(actualDestAmount);

            // transfer back only requested dest amount.
            destAddress.transfer(userExpectedDestAmount); 
        }

        emit TradeExecute(msg.sender, srcToken, srcAmount, destToken, userExpectedDestAmount, destAddress);

        return true;
    }

}

