pragma solidity ^0.4.20;


import "./ERC20Interface.sol";
import "./BalanceTracker.sol";
import "./Base.sol";
import "./ConversionAgentInterface.sol";

/**
 * The ConversionAgent contract does this and that...
 */
contract ConversionAgent is ConversionAgentInterface, BalanceTracker, Base{

    struct StepFunction{
        //x: value range for variable; y: dependent variable
        int[] x;
        int[] y;
    }

    //information relevant token rate 
    struct TokenData {
        bool listed;
        bool enabled; 

        uint compactDataArrayIndex;
        uint compactDataFieldIndex;

        uint baseBuyRate;
        uint baseSellRate;
        StepFunction buyRateQtyStepFunc;
        StepFunction sellRateQtyStepFunc;
        StepFunction buyRateImbalanceStepFunc;
        StepFunction sellRateImbalanceStepFunc;
    }

    uint public validRateDurationInBlocks = 10;
    ERC20[] internal listedTokens;
    mapping(address=>TokenData) internal tokenData;
    bytes32[] internal tokenRatesCompactData;
    uint public numTokensInCurrentCompactData = 0;
    address public supplierContract;
    uint constant internal NUM_TOKENS_IN_COMPACT_DATA = 14;
    uint constant internal BYTES_14_OFFSET = (2 ** (8 * NUM_TOKENS_IN_COMPACT_DATA));
    uint constant internal MAX_STEPS_IN_FUNCTION = 10;
    int  constant internal MAX_BPS_ADJUSTMENT = 10 ** 11; // 1B %
    int  constant internal MIN_BPS_ADJUSTMENT = -100 * 100; // cannot go down by more than 100%

    constructor (address _admin) public BalanceTracker(_admin){
    }

    function addToken(ERC20 token) public onlyAdmin{
        require(!tokenData[token].listed);
        tokenData[token].listed = true;
        listedTokens.push(token);

        if(numTokensInCurrentCompactData==0){
            tokenRatesCompactData.length++;
        }

        tokenData[token].compactDataArrayIndex = tokenRatesCompactData.length - 1;
        tokenData[token].compactDataFieldIndex = numTokensInCurrentCompactData;

        numTokensInCurrentCompactData = (numTokensInCurrentCompactData + 1) % NUM_TOKENS_IN_COMPACT_DATA;

        setGarbageToVolumeRecorder(token);

        setDecimals(token);
    }

    event LogCompactData(uint buy, uint sell, uint blockNumer);
    function setCompactData(bytes14[] buy, bytes14[] sell, uint blockNumber, uint[] indices) public onlyOperator{
        require(buy.length == sell.length);
        require(indices.length == buy.length);
        require(blockNumber <= 0xFFFFFFFF);

        uint bytes14Offset = BYTES_14_OFFSET;
        for(uint i=0; i<indices.length; i++){
            require(indices[i] < tokenRatesCompactData.length);
            //14byte->uint(buy) | 14byte->uint(sell) * byte14 | (
            emit LogCompactData(uint(buy[i]), uint(sell[i]), blockNumber);
            //20441799243135961136544514575630 | 427680768539985186903642265887010 * 5192296858534827628530496329220096 
            uint data = uint(buy[i]) | uint(sell[i]) * bytes14Offset | (blockNumber * (bytes14Offset * bytes14Offset));
            tokenRatesCompactData[indices[i]] = bytes32(data);
        }
        
    }    

    function setBaseRate(ERC20[] tokens, uint[] baseBuy, uint[] baseSell, bytes14[] buy, bytes14[] sell, uint blockNumber, uint[] indices) public onlyOperator{
        require(tokens.length == baseBuy.length);
        require(tokens.length == baseSell.length);
        require(sell.length == buy.length);
        require(sell.length == indices.length);

        for(uint i=0; i<tokens.length; i++){
            require(tokenData[tokens[i]].listed);
            tokenData[tokens[i]].baseBuyRate = baseBuy[i];
            tokenData[tokens[i]].baseSellRate = baseSell[i];
        }

        setCompactData(buy, sell, blockNumber, indices);
    }

    function setQtyStepFunction(ERC20 token, int[] xBuy, int[] yBuy, int[] xSell, int[] ySell) public onlyOperator{
        require(xBuy.length == yBuy.length);
        require(xSell.length == ySell.length);
        require(xBuy.length <= MAX_STEPS_IN_FUNCTION);
        require(xSell.length <= MAX_STEPS_IN_FUNCTION);
        require(tokenData[token].listed);

        tokenData[token].buyRateQtyStepFunc = StepFunction(xBuy, yBuy);
        tokenData[token].sellRateQtyStepFunc = StepFunction(xSell, ySell);
    }

    function setImbalanceStepFunction(ERC20 token, int[] xBuy, int[] yBuy, int[] xSell, int[] ySell) public onlyOperator{
        require(xBuy.length == yBuy.length);
        require(xSell.length == ySell.length);
        require(xBuy.length <= MAX_STEPS_IN_FUNCTION);
        require(xSell.length <= MAX_STEPS_IN_FUNCTION);
        require(tokenData[token].listed);

        tokenData[token].buyRateImbalanceStepFunc = StepFunction(xBuy, yBuy);
        tokenData[token].sellRateImbalanceStepFunc = StepFunction(xSell, ySell);
    }

    function setValidRateDurationInBlocks(uint duration) public onlyAdmin {
        validRateDurationInBlocks = duration;
    }

    function enableTokenTrade(ERC20 token) public onlyAdmin {
        require(tokenData[token].listed);
        require(tokenControlInfo[token].minimalRecordResolution != 0);
        tokenData[token].enabled = true;
    }

    function disableTokenTrade(ERC20 token) public onlyQuoter {
        require(tokenData[token].listed);
        tokenData[token].enabled = false;
    }

    function setSupplierAddress(address supplier) public onlyAdmin {
        supplierContract = supplier;
    }

    function logImbalance(ERC20 token, int buyAmount, uint rateUpdateBlock, uint currentBlock) public {
        require(msg.sender == supplierContract);

        if (rateUpdateBlock == 0) rateUpdateBlock = getRateUpdateBlock(token);

        addImbalance(token, buyAmount, rateUpdateBlock, currentBlock);
    }

    /* solhint-disable function-max-lines */
    function getRate(ERC20 token, uint currentBlockNumber, bool buy, uint qty) public view returns(uint) {
        // check if trade is enabled
        if (!tokenData[token].enabled) return 0;
        if (tokenControlInfo[token].minimalRecordResolution == 0) return 0; // token control info not set

        // get rate update block
        bytes32 compactData = tokenRatesCompactData[tokenData[token].compactDataArrayIndex];

        uint updateRateBlock = getLast4Bytes(compactData);
        if (currentBlockNumber >= updateRateBlock + validRateDurationInBlocks) return 0; // rate is expired
        // check imbalance
        int totalImbalance;
        int blockImbalance;
        (totalImbalance, blockImbalance) = getImbalance(token, updateRateBlock, currentBlockNumber);

        // calculate actual rate
        int imbalanceQty;
        int extraBps;
        int8 rateUpdate;
        uint rate;

        if (buy) {
            // start with base rate
            rate = tokenData[token].baseBuyRate;

            // add rate update
            rateUpdate = getRateByteFromCompactData(compactData, token, true);
            extraBps = int(rateUpdate) * 10;
            rate = addBps(rate, extraBps);

            // compute token qty
            qty = getTokenQty(token, rate, qty);
            imbalanceQty = int(qty);
            totalImbalance += imbalanceQty;

            // add qty overhead
            extraBps = executeStepFunction(tokenData[token].buyRateQtyStepFunc, int(qty));
            rate = addBps(rate, extraBps);

            // add imbalance overhead
            extraBps = executeStepFunction(tokenData[token].buyRateImbalanceStepFunc, totalImbalance);
            rate = addBps(rate, extraBps);
        } else {
            // start with base rate
            rate = tokenData[token].baseSellRate;

            // add rate update
            rateUpdate = getRateByteFromCompactData(compactData, token, false);
            extraBps = int(rateUpdate) * 10;
            rate = addBps(rate, extraBps);

            // compute token qty
            imbalanceQty = -1 * int(qty);
            totalImbalance += imbalanceQty;

            // add qty overhead
            extraBps = executeStepFunction(tokenData[token].sellRateQtyStepFunc, int(qty));
            rate = addBps(rate, extraBps);

            // add imbalance overhead
            extraBps = executeStepFunction(tokenData[token].sellRateImbalanceStepFunc, totalImbalance);
            rate = addBps(rate, extraBps);
        }

        if (abs(totalImbalance) >= getMaxTotalImbalance(token)) return 0;
        if (abs(blockImbalance + imbalanceQty) >= getMaxPerBlockImbalance(token)) return 0;

        return rate;
    }
    /* solhint-enable function-max-lines */

    function getBasicRate(ERC20 token, bool buy) public view returns(uint) {
        if (buy)
            return tokenData[token].baseBuyRate;
        else
            return tokenData[token].baseSellRate;
    }

    function getCompactData(ERC20 token) public view returns(uint, uint, byte, byte) {
        require(tokenData[token].listed);

        uint arrayIndex = tokenData[token].compactDataArrayIndex;
        uint fieldOffset = tokenData[token].compactDataFieldIndex;

        return (
            arrayIndex,
            fieldOffset,
            byte(getRateByteFromCompactData(tokenRatesCompactData[arrayIndex], token, true)),
            byte(getRateByteFromCompactData(tokenRatesCompactData[arrayIndex], token, false))
        );
    }

    function getTokenBasicData(ERC20 token) public view returns(bool, bool) {
        return (tokenData[token].listed, tokenData[token].enabled);
    }

    /* solhint-disable code-complexity */
    function getStepFunctionData(ERC20 token, uint command, uint param) public view returns(int) {
        if (command == 0) return int(tokenData[token].buyRateQtyStepFunc.x.length);
        if (command == 1) return tokenData[token].buyRateQtyStepFunc.x[param];
        if (command == 2) return int(tokenData[token].buyRateQtyStepFunc.y.length);
        if (command == 3) return tokenData[token].buyRateQtyStepFunc.y[param];

        if (command == 4) return int(tokenData[token].sellRateQtyStepFunc.x.length);
        if (command == 5) return tokenData[token].sellRateQtyStepFunc.x[param];
        if (command == 6) return int(tokenData[token].sellRateQtyStepFunc.y.length);
        if (command == 7) return tokenData[token].sellRateQtyStepFunc.y[param];

        if (command == 8) return int(tokenData[token].buyRateImbalanceStepFunc.x.length);
        if (command == 9) return tokenData[token].buyRateImbalanceStepFunc.x[param];
        if (command == 10) return int(tokenData[token].buyRateImbalanceStepFunc.y.length);
        if (command == 11) return tokenData[token].buyRateImbalanceStepFunc.y[param];

        if (command == 12) return int(tokenData[token].sellRateImbalanceStepFunc.x.length);
        if (command == 13) return tokenData[token].sellRateImbalanceStepFunc.x[param];
        if (command == 14) return int(tokenData[token].sellRateImbalanceStepFunc.y.length);
        if (command == 15) return tokenData[token].sellRateImbalanceStepFunc.y[param];

        revert();
    }

    function getRateUpdateBlock(ERC20 token) public view returns(uint) {
        bytes32 compactData = tokenRatesCompactData[tokenData[token].compactDataArrayIndex];
        return getLast4Bytes(compactData);
    }

    function getListedTokens() public view returns(ERC20[]) {
        return listedTokens;
    }

    function getTokenQty(ERC20 token, uint ethQty, uint rate) internal view returns(uint) {
        uint dstDecimals = getDecimals(token);
        uint srcDecimals = ETH_DECIMALS;

        return calcDstQty(ethQty, srcDecimals, dstDecimals, rate);
    }

    function getLast4Bytes(bytes32 b) internal pure returns(uint) {
        return uint(b) / (BYTES_14_OFFSET * BYTES_14_OFFSET);
    }

    function getRateByteFromCompactData(bytes32 data, ERC20 token, bool buy) internal view returns(int8) {
        uint fieldOffset = tokenData[token].compactDataFieldIndex;
        uint byteOffset;
        if (buy)
            byteOffset = 32 - NUM_TOKENS_IN_COMPACT_DATA + fieldOffset;
        else
            byteOffset = 4 + fieldOffset;

        return int8(data[byteOffset]);
    }

    function executeStepFunction(StepFunction f, int x) internal pure returns(int) {
        uint len = f.y.length;
        for (uint ind = 0; ind < len; ind++) {
            if (x <= f.x[ind]) return f.y[ind];
        }

        return f.y[len-1];
    }

    function addBps(uint rate, int bps) internal pure returns(uint) {
        require(rate <= MAX_RATE);
        require(bps >= MIN_BPS_ADJUSTMENT);
        require(bps <= MAX_BPS_ADJUSTMENT);

        uint maxBps = 100 * 100;
        return (rate * uint(int(maxBps) + bps)) / maxBps;
    }

    function abs(int x) internal pure returns(uint) {
        if (x < 0)
            return uint(-1 * x);
        else
            return uint(x);
    }
}

