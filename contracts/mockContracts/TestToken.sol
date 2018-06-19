pragma solidity ^0.4.20;


import "zeppelin-solidity/contracts/token/ERC20/StandardToken.sol";


contract TestToken is StandardToken{
    string public name = "Test";
    string public symbol = "TST";
    uint public decimals = 18;
    uint public INITIAL_SUPPLY = 10**(50+18);

    constructor(string _name, string _symbol, uint _decimals) public{
        totalSupply_ = INITIAL_SUPPLY;
        balances[msg.sender] = INITIAL_SUPPLY;
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }
}