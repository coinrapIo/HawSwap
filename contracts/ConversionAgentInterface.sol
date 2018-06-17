pragma solidity ^0.4.20;

import "./ERC20Interface.sol";


interface ConversionAgentInterface {

    function logImbalance(
        ERC20 token,
        int buyAmount,
        uint rateUpdateBlock,
        uint currentBlock
    )
        public;

    function getRate(
    	ERC20 token, 
    	uint currentBlockNumber, 
    	bool buy, 
    	uint qty
    ) public view returns(uint);
}