pragma solidity ^0.4.18;


import "./ERC20Interface.sol";
import "./MartletInstantlyTrader.sol";
import "./Withdrawable.sol";
import "./Base.sol";
import "./ExpectedRateInterface.sol";


contract ExpectedRate is Withdrawable, ExpectedRateInterface, Base {

    MartletInstantlyTrader public martletInstantlyTrader;
    uint public quantityFactor = 2;
    uint public minSlippageFactorInBps = 50;

    function ExpectedRate(MartletInstantlyTrader _martletInstantlyTrader, address _admin) public {
        require(_admin != address(0));
        require(_martletInstantlyTrader != address(0));
        martletInstantlyTrader = _martletInstantlyTrader;
        admin = _admin;
    }

    event QuantityFactorSet (uint newFactor, uint oldFactor, address sender);

    function setQuantityFactor(uint newFactor) public onlyOperator {
        require(newFactor <= 100);

        emit QuantityFactorSet(quantityFactor, newFactor, msg.sender);
        quantityFactor = newFactor;
    }

    event MinSlippageFactorSet (uint newMin, uint oldMin, address sender);

    function setMinSlippageFactor(uint bps) public onlyOperator {
        require(minSlippageFactorInBps <= 100 * 100);

        emit MinSlippageFactorSet(bps, minSlippageFactorInBps, msg.sender);
        minSlippageFactorInBps = bps;
    }

    function getExpectedRate(ERC20 src, ERC20 dest, uint srcQty)
        public view
        returns (uint expectedRate, uint slippageRate)
    {
        require(quantityFactor != 0);
        require(srcQty <= MAX_QTY);
        require(srcQty * quantityFactor <= MAX_QTY);

        uint bestReserve;
        uint minSlippage;

        (bestReserve, expectedRate) = martletInstantlyTrader.findBestRate(src, dest, srcQty);
        (bestReserve, slippageRate) = martletInstantlyTrader.findBestRate(src, dest, (srcQty * quantityFactor));

        require(expectedRate <= MAX_RATE);
        minSlippage = ((10000 - minSlippageFactorInBps) * expectedRate) / 10000;
        if (slippageRate >= minSlippage) {
            slippageRate = minSlippage;
        }

        return (expectedRate, slippageRate);
    }
}
