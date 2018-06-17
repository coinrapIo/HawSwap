pragma solidity ^0.4.20;


import "./ERC20Interface.sol";

interface SanityRatesInterface {
    function getSanityRate(ERC20 src, ERC20 dest) public view returns(uint);
}
