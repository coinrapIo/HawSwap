pragma solidity ^0.4.20;

import "./ERC20Interface.sol";


interface ConversionAgentInterface {

    function logImbalance(
        ERC20 token,
        int buyAmount,
        uint rateUpdateBlock,
        uint currentBlock
    )
        external;

    function getRate(
    	ERC20 token, 
    	uint currentBlockNumber, 
    	bool buy, 
    	uint qty
    ) external view returns(uint);
}