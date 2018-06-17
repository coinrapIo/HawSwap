pragma solidity ^0.4.18;


import "../ConversionAgent.sol";

contract MockConversionRate is ConversionAgent {
    function MockConversionRate(address admin) ConversionAgent(admin) public {

    }

    function mockGetImbalance(ERC20 token, uint rateUpdateBlock, uint currentBlock) public view
        returns(int totalImbalance, int currentBlockImbalance)
    {
        (totalImbalance, currentBlockImbalance) = getImbalance(token, rateUpdateBlock, currentBlock);
//        return(totalImbalance, currentBlockImbalance);
    }

    function mockGetMaxTotalImbalance(ERC20 token) public view returns(uint) {
        return getMaxTotalImbalance(token);
    }

    function getUpdateRateBlockFromCompact (ERC20 token) public view returns(uint updateRateBlock) {
        // get rate update block
        bytes32 compactData = tokenRatesCompactData[tokenData[token].compactDataArrayIndex];
        updateRateBlock = getLast4Bytes(compactData);
    }

    function mockAddBps(uint rate, int bps) public pure returns(uint) {
        return addBps(rate, bps);
    }
}
