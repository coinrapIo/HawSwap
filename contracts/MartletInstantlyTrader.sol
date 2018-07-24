pragma solidity ^0.4.18;


import "./ERC20Interface.sol";
import "./SupplierInterface.sol";
import "./Withdrawable.sol";
import "./Base.sol";
import "./PermissionGroups.sol";
import "./WhiteListInterface.sol";
import "./ExpectedRateInterface.sol";



contract MartletInstantlyTrader is Withdrawable, Base {

    uint public negligibleRateDiff = 10; // basic rate steps will be in 0.01%
    SupplierInterface[] public suppliers;
    mapping(address=>bool) public isSupplier;
    WhiteListInterface public whiteListContract;
    ExpectedRateInterface public expectedRateContract;
    uint                  public maxGasPrice = 50 * 1000 * 1000 * 1000; // 50 gwei
    bool                  public enabled = false; // network is enabled
    mapping(bytes32=>uint) public info; // this is only a UI field for external app.
    mapping(address=>mapping(bytes32=>bool)) public perSupplierListedPairs;

    constructor (address _admin) public {
        require(_admin != address(0));
        admin = _admin;
    }

    event EtherReceival(address indexed sender, uint amount);

    /* solhint-disable no-complex-fallback */
    function() public payable {
        require(isSupplier[msg.sender]);
        emit EtherReceival(msg.sender, msg.value);
    }
    /* solhint-enable no-complex-fallback */

    event ExecuteTrade(address indexed sender, ERC20 src, ERC20 dest, uint actualSrcAmount, uint actualDestAmount);

    /// @notice use token address ETH_TOKEN_ADDRESS for ether
    /// @dev makes a trade between src and dest token and send dest token to destAddress
    /// @param src Src token
    /// @param srcAmount amount of src tokens
    /// @param dest   Destination token
    /// @param destAddress Address to send tokens to
    /// @param maxDestAmount A limit on the amount of dest tokens
    /// @param minConversionRate The minimal conversion rate. If actual rate is lower, trade is canceled.
    /// @return amount of actual dest tokens
    function trade(
        ERC20 src,
        uint srcAmount,
        ERC20 dest,
        address destAddress,
        uint maxDestAmount,
        uint minConversionRate
    )
        public
        payable
        returns(uint)
    {
        require(enabled);

        uint userSrcBalanceBefore;
        uint userSrcBalanceAfter;
        uint userDestBalanceBefore;
        uint userDestBalanceAfter;

        userSrcBalanceBefore = getBalance(src, msg.sender);
        if (src == ETH_TOKEN_ADDRESS)
            userSrcBalanceBefore += msg.value;
        userDestBalanceBefore = getBalance(dest, destAddress);

        emit LogEx(srcAmount, maxDestAmount, minConversionRate);
        uint actualDestAmount = doTrade(src,
                                        srcAmount,
                                        dest,
                                        destAddress,
                                        maxDestAmount,
                                        minConversionRate
                                        );
        require(actualDestAmount > 0);

        userSrcBalanceAfter = getBalance(src, msg.sender);
        userDestBalanceAfter = getBalance(dest, destAddress);

        require(userSrcBalanceAfter <= userSrcBalanceBefore);
        require(userDestBalanceAfter >= userDestBalanceBefore);

        require((userDestBalanceAfter - userDestBalanceBefore) >=
            calcDstQty((userSrcBalanceBefore - userSrcBalanceAfter), getDecimals(src), getDecimals(dest),
                minConversionRate));

        return actualDestAmount;
    }

    event AddSupplier(SupplierInterface supplier, bool add);

    /// @notice can be called only by admin
    /// @dev add or deletes a supplier to/from the network.
    /// @param supplier The supplier address.
    /// @param add If true, the add supplier. Otherwise delete supplier.
    function addSupplier(SupplierInterface supplier, bool add) public onlyAdmin {

        if (add) {
            require(!isSupplier[supplier]);
            suppliers.push(supplier);
            isSupplier[supplier] = true;
            emit AddSupplier(supplier, true);
        } else {
            isSupplier[supplier] = false;
            for (uint i = 0; i < suppliers.length; i++) {
                if (suppliers[i] == supplier) {
                    suppliers[i] = suppliers[suppliers.length - 1];
                    suppliers.length--;
                    emit AddSupplier(supplier, false);
                    break;
                }
            }
        }
    }

    event ListSupplierPairs(address supplier, ERC20 src, ERC20 dest, address caller, uint srcAmnt, uint destAmnt, bool add);

    /// @notice can be called only by admin
    /// @dev allow or prevent a specific supplier to trade a pair of tokens
    /// @param supplier The supplier address.
    /// @param src Src token
    /// @param dest Destination token
    /// @param add If true then enable trade, otherwise delist pair.
    function listPairForSupplier(address supplier, ERC20 src, ERC20 dest, bool add) public onlyAdmin {
        (perSupplierListedPairs[supplier])[keccak256(src, dest)] = add;

        if (src != ETH_TOKEN_ADDRESS) {
            if (add) {
                src.approve(supplier, 2**255); // approve infinity
                // src.approve(supplier, src.balanceOf(msg.sender));
            } else {
                src.approve(supplier, 0);
            }
        }

        setDecimals(src);
        setDecimals(dest);

        emit ListSupplierPairs(supplier, src, dest, msg.sender,getBalance(src, msg.sender), getBalance(dest, msg.sender), add);
    }

    function setParams(
        WhiteListInterface    _whiteList,
        ExpectedRateInterface _expectedRate,
        uint                  _maxGasPrice,
        uint                  _negligibleRateDiff
    )
        public
        onlyAdmin
    {
        require(_whiteList != address(0));
        require(_expectedRate != address(0));
        require(_negligibleRateDiff <= 100 * 100); // at most 100%
        
        whiteListContract = _whiteList;
        expectedRateContract = _expectedRate;
        maxGasPrice = _maxGasPrice;
        negligibleRateDiff = _negligibleRateDiff;
    }

    function setEnable(bool _enable) public onlyAdmin {
        if (_enable) {
            require(whiteListContract != address(0));
            require(expectedRateContract != address(0));
        }
        enabled = _enable;
    }

    function setInfo(bytes32 field, uint value) public onlyOperator {
        info[field] = value;
    }

    /// @dev returns number of suppliers
    /// @return number of suppliers
    function getNumSuppliers() public view returns(uint) {
        return suppliers.length;
    }

    /// @notice should be called off chain with as much gas as needed
    /// @dev get an array of all suppliers
    /// @return An array of all suppliers
    function getSuppliers() public view returns(SupplierInterface[]) {
        return suppliers;
    }

    /// @dev get the balance of a user.
    /// @param token The token type
    /// @return The balance
    function getBalance(ERC20 token, address user) public view returns(uint) {
        if (token == ETH_TOKEN_ADDRESS)
            return user.balance;
        else
            return token.balanceOf(user);
    }

    /// @notice use token address ETH_TOKEN_ADDRESS for ether
    /// @dev best conversion rate for a pair of tokens, if number of suppliers have small differences. randomize
    /// @param src Src token
    /// @param dest Destination token
    /* solhint-disable code-complexity */
    function findBestRate(ERC20 src, ERC20 dest, uint srcQty) public view returns(uint, uint) {
        uint bestRate = 0;
        uint bestSupplier = 0;
        uint numRelevantSuppliers = 0;
        uint numSuppliers = suppliers.length;
        uint[] memory rates = new uint[](numSuppliers);
        uint[] memory supplierCandidates = new uint[](numSuppliers);

        for (uint i = 0; i < numSuppliers; i++) {
            //list all suppliers that have this token.
            if (!(perSupplierListedPairs[suppliers[i]])[keccak256(src, dest)]) continue;

            rates[i] = suppliers[i].getConversionRate(src, dest, srcQty, block.number);

            if (rates[i] > bestRate) {
                //best rate is highest rate
                bestRate = rates[i];
            }
        }

        if (bestRate > 0) {
            uint random = 0;
            uint smallestRelevantRate = (bestRate * 10000) / (10000 + negligibleRateDiff);

            for (i = 0; i < numSuppliers; i++) {
                if (rates[i] >= smallestRelevantRate) {
                    supplierCandidates[numRelevantSuppliers++] = i;
                }
            }

            if (numRelevantSuppliers > 1) {
                //when encountering small rate diff from bestRate. draw from relevant suppliers
                random = uint(blockhash(block.number-1)) % numRelevantSuppliers;
            }

            bestSupplier = supplierCandidates[random];
            bestRate = rates[bestSupplier];
        }

        return (bestSupplier, bestRate);
    }
    /* solhint-enable code-complexity */

    function getExpectedRate(ERC20 src, ERC20 dest, uint srcQty)
        public view
        returns (uint expectedRate, uint slippageRate)
    {
        require(expectedRateContract != address(0));
        return expectedRateContract.getExpectedRate(src, dest, srcQty);
    }

    function getUserCapInWei(address user) public view returns(uint) {
        return whiteListContract.getUserCapInWei(user);
    }

    event LogEx(uint no, uint n1, uint n2);

    function doTrade(
        ERC20 src,
        uint srcAmount,
        ERC20 dest,
        address destAddress,
        uint maxDestAmount,
        uint minConversionRate
    )
        internal
        returns(uint)
    {
        require(tx.gasprice <= maxGasPrice);
        require(validateTradeInput(src, srcAmount, destAddress));

        uint supplierInd;
        uint rate;

        (supplierInd, rate) = findBestRate(src, dest, srcAmount);
        SupplierInterface theSupplier = suppliers[supplierInd];
        require(rate > 0);
        require(rate < MAX_RATE);
        require(rate >= minConversionRate);

        uint actualSrcAmount = srcAmount;
        uint actualDestAmount = calcDestAmount(src, dest, actualSrcAmount, rate);
        if (actualDestAmount > maxDestAmount) {
            actualDestAmount = maxDestAmount;
            actualSrcAmount = calcSrcAmount(src, dest, actualDestAmount, rate);
            require(actualSrcAmount <= srcAmount);
        }
        emit LogEx(srcAmount, actualSrcAmount, actualDestAmount);

        // do the trade
        // verify trade size is smaller than user cap
        uint ethAmount;
        if (src == ETH_TOKEN_ADDRESS) {
            ethAmount = actualSrcAmount;
        } else {
            ethAmount = actualDestAmount;
        }

        require(ethAmount <= getUserCapInWei(msg.sender));
        require(doSupplierTrade(
                src,
                actualSrcAmount,
                dest,
                destAddress,
                actualDestAmount,
                theSupplier,
                rate,
                true));

        if ((actualSrcAmount < srcAmount) && (src == ETH_TOKEN_ADDRESS)) {
            msg.sender.transfer(srcAmount - actualSrcAmount);
        }


        emit ExecuteTrade(msg.sender, src, dest, actualSrcAmount, actualDestAmount);
        return actualDestAmount;
    }

    /// @notice use token address ETH_TOKEN_ADDRESS for ether
    /// @dev do one trade with a supplier
    /// @param src Src token
    /// @param amount amount of src tokens
    /// @param dest   Destination token
    /// @param destAddress Address to send tokens to
    /// @param supplier Supplier to use
    /// @param validate If true, additional validations are applicable
    /// @return true if trade is successful
    function doSupplierTrade(
        ERC20 src,
        uint amount,
        ERC20 dest,
        address destAddress,
        uint expectedDestAmount,
        SupplierInterface supplier,
        uint conversionRate,
        bool validate
    )
        internal
        returns(bool)
    {
        uint callValue = 0;
        
        if (src == ETH_TOKEN_ADDRESS) {
            callValue = amount;
        } else {
            // take src tokens to this contract
            require(src.transferFrom(msg.sender, this, amount));
        }

        // supplier sends tokens/eth to network. network sends it to destination

        require(supplier.trade.value(callValue)(src, amount, dest, this, conversionRate, validate));
        emit SupplierTrade(callValue, src, amount, dest, this, conversionRate, validate);

        if (dest == ETH_TOKEN_ADDRESS) {
            destAddress.transfer(expectedDestAmount);
        } else {
            require(dest.transfer(destAddress, expectedDestAmount));
        }

        return true;
    }

    event SupplierTrade(uint v, ERC20 src, uint amnt, ERC20 dest, address destAddress, uint conversionRate, bool validate);

    function calcDestAmount(ERC20 src, ERC20 dest, uint srcAmount, uint rate) internal view returns(uint) {
        return calcDstQty(srcAmount, getDecimals(src), getDecimals(dest), rate);
    }

    function calcSrcAmount(ERC20 src, ERC20 dest, uint destAmount, uint rate) internal view returns(uint) {
        return calcSrcQty(destAmount, getDecimals(src), getDecimals(dest), rate);
    }

    /// @notice use token address ETH_TOKEN_ADDRESS for ether
    /// @dev checks that user sent ether/tokens to contract before trade
    /// @param src Src token
    /// @param srcAmount amount of src tokens
    /// @return true if input is valid
    function validateTradeInput(ERC20 src, uint srcAmount, address destAddress) internal view returns(bool) {
        if ((srcAmount >= MAX_QTY) || (srcAmount == 0) || (destAddress == 0))
            return false;

        if (src == ETH_TOKEN_ADDRESS) {
            if (msg.value != srcAmount)
                return false;
        } else {
            if ((msg.value != 0) || (src.allowance(msg.sender, this) < srcAmount))
                return false;
        }

        return true;
    }
}
