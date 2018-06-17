let ConversionAgent = artifacts.require("./ConversionAgent.sol");
let TestToken = artifacts.require("./mockContracts/TestToken.sol");
let Wrapper = artifacts.require("./mockContracts/Wrapper.sol");
let Supplier = artifacts.require("./Supplier.sol");
let SanityRates = artifacts.require("./SanityRates.sol");

let Helper = require("./helper.js");
let BigNumber = require('bignumber.js');

//global variables
//////////////////
let precisionUnits = (new BigNumber(10).pow(18));
let ethAddress = '0x00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
let precision = new BigNumber(10).pow(18);

//balances
let expectedSupplierBalanceWei = 0;
let reserveTokenBalance = [];
let reserveTokenImbalance = [];

//permission groups
let admin;
let operator;
let alerter;
let network;
let withDrawAddress;

//contracts
let convRatesInst;
let supplierInst;
let sanityRate = 0;

//block data
let priceUpdateBlock;
let currentBlock;
let validRateDurationInBlocks = 1000;

//tokens data
////////////
let numTokens = 5;
let tokens = [];
let tokenAdd = [];

// imbalance data
let minimalRecordResolution = 2; //low resolution so I don't lose too much data. then easier to compare calculated imbalance values.
let maxPerBlockImbalance = 4000;
let maxTotalImbalance = maxPerBlockImbalance * 12;

// all price steps in bps (basic price steps).
// 100 bps means rate change will be: price * (100 + 10000) / 10000 == raise rate in 1%
// higher rate is better for user. will get more dst quantity for his tokens.
// all x values represent token imbalance. y values represent equivalent steps in bps.
// buyImbalance represents coin shortage. higher buy imbalance = more tokens were bought.
// generally. speaking, if imbalance is higher we want to have:
//      - smaller buy bps (negative) to lower rate when buying token with ether.
//      - bigger sell bps to have higher rate when buying ether with token.
////////////////////

//base buy and sell rates (prices)
let baseBuyRate = [];
let baseSellRate = [];

//quantity buy steps
let qtyBuyStepX = [-1400, -700, -150, 0, 150, 350, 700,  1400];
let qtyBuyStepY = [ 1000,   75,   25, 0,  0, -70, -160, -3000];

//imbalance buy steps
let imbalanceBuyStepX = [-8500, -2800, -1500, 0, 1500, 2800,  4500];
let imbalanceBuyStepY = [ 1300,   130,    43, 0,   0, -110, -1600];

//sell
//sell price will be 1 / buy (assuming no spread) so sell is actually buy price in other direction
let qtySellStepX = [-1400, -700, -150, 0, 150, 350, 700, 1400];
let qtySellStepY = [-300,   -80,  -15, 0,   0, 120, 170, 3000];

//sell imbalance step
let imbalanceSellStepX = [-8500, -2800, -1500, 0, 1500, 2800,  4500];
let imbalanceSellStepY = [-1500,  -320,   -75, 0,    0,  110,   650];


//compact data.
let sells = [];
let buys = [];
let indices = [];
let compactBuyArr = [];
let compactSellArr = [];

contract('Supplier', function(accounts) {
    it("should init globals. init ConversionAgent Inst, init tokens and add to pricing inst. set basic data per token.", async function () {
        // set account addresses
        admin = accounts[0];
        operator = accounts[1];
        network = accounts[2];
        user1 = accounts[4];
        user2 = accounts[5];
        withDrawAddress = accounts[6];
        sanityRate = accounts[7];
        alerter = accounts[8];

        currentBlock = priceUpdateBlock = await Helper.getCurrentBlock();

//        console.log("current block: " + currentBlock);
        //init contracts
        convRatesInst = await ConversionAgent.new(admin, {});

        //set pricing general parameters
        await convRatesInst.setValidRateDurationInBlocks(validRateDurationInBlocks);

        //create and add token addresses...
        for (let i = 0; i < numTokens; ++i) {
            token = await TestToken.new("test" + i, "tst" + i, 18);
            tokens[i] = token;
            tokenAdd[i] = token.address;
            await convRatesInst.addToken(token.address);
            await convRatesInst.setTokenControlInfo(token.address, minimalRecordResolution, maxPerBlockImbalance, maxTotalImbalance);
            await convRatesInst.enableTokenTrade(token.address);
        }

        assert.equal(tokens.length, numTokens, "bad number tokens");

        let result = await convRatesInst.addOperator(operator);
        await convRatesInst.addQuoter(alerter);
    });

    it("should set base prices + compact data price factor + step function. for all tokens.", async function () {
        //buy is ether to token rate. sale is token to ether rate. so sell == 1 / buy. assuming we have no spread.
        let tokensPerEther;
        let ethersPerToken;

        for (i = 0; i < numTokens; ++i) {
            tokensPerEther = (new BigNumber(precisionUnits.mul((i + 1) * 3)).floor());
            ethersPerToken = (new BigNumber(precisionUnits.div((i + 1) * 3)).floor());
            baseBuyRate.push(tokensPerEther.valueOf());
            baseSellRate.push(ethersPerToken.valueOf());
        }
        assert.equal(baseBuyRate.length, tokens.length);
        assert.equal(baseSellRate.length, tokens.length);

        buys.length = sells.length = indices.length = 0;

        await convRatesInst.setBaseRate(tokenAdd, baseBuyRate, baseSellRate, buys, sells, currentBlock, indices, {from: operator});

        //set compact data
        compactBuyArr = [0, 12, -5, 0, 0, 06, 07, 08, 09, 10, 11, 12, 13, 14];
        let compactBuyHex = Helper.bytesToHex(compactBuyArr);
        buys.push(compactBuyHex);

        compactSellArr = [0, -50, 95, 0, 0, 26, 27, 28, 29, 30, 31, 32, 33, 34];
        let compactSellHex = Helper.bytesToHex(compactSellArr);
        sells.push(compactSellHex);

        indices[0] = 0;

        assert.equal(indices.length, sells.length, "bad sells array size");
        assert.equal(indices.length, buys.length, "bad buys array size");

        await convRatesInst.setCompactData(buys, sells, currentBlock, indices, {from: operator});

        //all start with same step functions.
        for (let i = 0; i < numTokens; ++i) {
            await convRatesInst.setQtyStepFunction(tokenAdd[i], qtyBuyStepX, qtyBuyStepY, qtySellStepX, qtySellStepY, {from:operator});
            await convRatesInst.setImbalanceStepFunction(tokenAdd[i], imbalanceBuyStepX, imbalanceBuyStepY, imbalanceSellStepX, imbalanceSellStepY, {from:operator});
        }
    });

    it("should init reserve and set all reserve data including balances", async function () {
        supplierInst = await Supplier.new(network, convRatesInst.address, admin);
        var events = supplierInst.allEvents([]);
        events.watch(function(error, event){
            if(!error){
                console.log(event);
            }
            else{
                console.log("error: ", error);
            }
        });
        await supplierInst.setContracts(network, convRatesInst.address, 0);

        await supplierInst.addOperator(operator);
        await supplierInst.addQuoter(alerter);
        await convRatesInst.setSupplierAddress(supplierInst.address);

        //set reserve balance. 10000 wei ether + per token 1000 wei ether value according to base price.
        let reserveEtherInit = 5000 * 2;
        await Helper.sendEtherWithPromise(accounts[9], supplierInst.address, reserveEtherInit);
        
        let balance = await Helper.getBalancePromise(supplierInst.address);
        expectedSupplierBalanceWei = balance.valueOf();

        assert.equal(balance.valueOf(), reserveEtherInit, "wrong ether balance");

        //transfer tokens to reserve. each token same wei balance
        for (let i = 0; i < numTokens; ++i) {
            token = tokens[i];
            let amount = (new BigNumber(reserveEtherInit)).mul(baseBuyRate[i]).div(precisionUnits);
            await token.transfer(supplierInst.address, amount.valueOf());
            let balance = await token.balanceOf(supplierInst.address);
            assert.equal(amount.valueOf(), balance.valueOf());
            reserveTokenBalance.push(amount);
            reserveTokenImbalance.push(0);
        }
    });

    it("should perform small buy (no steps) and check: balances changed, rate is expected rate.", async function () {
        let tokenInd = 3;
        let token = tokens[tokenInd]; //choose some token
        let amountWei = 2 * 1;



        //verify base rate
        let buyRate = await supplierInst.getConversionRate(ethAddress, tokenAdd[tokenInd], amountWei, currentBlock);
        let expectedRate = (new BigNumber(baseBuyRate[tokenInd]));
        let destQty = (new BigNumber(amountWei).mul(baseBuyRate[tokenInd])).div(precisionUnits);
        let extraBps = getExtraBpsForBuyQuantity(destQty);
        expectedRate = addBps(expectedRate, extraBps);

        //check correct rate calculated
        assert.equal(buyRate.valueOf(), expectedRate.valueOf(), "unexpected rate.");
        console.log("###################here!, value:", amountWei, "buyRate:", buyRate.valueOf());

        // let result = supplierInst.approveWithdrawAddress(user1, expectedSupplierBalanceWei, {from: admin});
        // console.log("result1:", result);

        //perform trade
        let result = await supplierInst.trade(ethAddress, amountWei, tokenAdd[tokenInd], user1, buyRate, true, {from:network, value:amountWei});
        console.log("result2:", result);

        //check higher ether balance on reserve
        expectedSupplierBalanceWei = (expectedSupplierBalanceWei * 1) + amountWei;
        expectedSupplierBalanceWei -= expectedSupplierBalanceWei % 1;
        let balance = await Helper.getBalancePromise(supplierInst.address);
        assert.equal(balance.valueOf(), expectedSupplierBalanceWei, "bad reserve balance wei");

        //check token balances
        ///////////////////////

        //check token balance on user1
        let tokenTweiBalance = await token.balanceOf(user1);
        let expectedTweiAmount = expectedRate.mul(amountWei).div(precisionUnits);
        assert.equal(tokenTweiBalance.valueOf(), expectedTweiAmount.valueOf(), "bad token balance");

        //check lower token balance on reserve
        //below is true since all tokens and ether have same decimals (18)
        reserveTokenBalance[tokenInd] -= expectedTweiAmount;
        reserveTokenImbalance[tokenInd] += (expectedTweiAmount * 1); //imbalance represents how many missing tokens
        let reportedBalance = await token.balanceOf(supplierInst.address);
        assert.equal(reportedBalance.valueOf(), reserveTokenBalance[tokenInd].valueOf(), "bad token balance on reserve");
    });


    // it("should perform a few buys with steps and check: correct balances change, rate is expected rate.", async function () {
    //     let tokenInd = 2;
    //     let token = tokens[tokenInd]; //choose some token
    //     let amountWei;
    //     let totalWei = 0 * 1;
    //     let totalExpectedTwei = 0 * 1;

    //     for (let i = 0; i > 19; i++) {
    //         amountWei = (7 * i) + 1;
    //         let buyRate = await supplierInst.getConversionRate(ethAddress, tokenAdd[tokenInd], amountWei, currentBlock);

    //         //verify price/rate against set price
    //         let expectedRate = (new BigNumber(baseBuyRate[tokenInd]));
    //         //first calculate number of destination tokens according to basic rate
    //         let destQty = (new BigNumber(amountWei).mul(baseBuyRate[tokenInd])).div(precisionUnits);
    //         let extraBps = getExtraBpsForBuyQuantity(destQty);
    //         expectedRate = addBps(expectedRate, extraBps);
    //         extraBps = getExtraBpsForImbalanceBuyQuantity(reserveTokenImbalance[token]);
    //         expectedRate = addBps(expectedRate, extraBps);

    //         assert.equal(buyRate.valueOf(), expectedRate.valueOf(0), "unexpected rate.");

    //         let expectedTweiAmount = expectedRate.mul(amountWei).div(precisionUnits);
    //         totalExpectedTwei += (1 * expectedTweiAmount);
    //         reserveTokenBalance[tokenInd].sub(expectedTweiAmount);

    //         await supplierInst.trade(ethAddress, amountWei, tokenAdd[tokenInd], user1, buyRate, true, {from : network, value:amountWei});
    //         totalWei += (1 * amountWei);
    //     };

    //     //check higher ether balance on reserve
    //     expectedSupplierBalanceWei = (expectedSupplierBalanceWei * 1) + totalWei;
    //     expectedSupplierBalanceWei -= expectedSupplierBalanceWei % 1;
    //     let balance = await Helper.getBalancePromise(supplierInst.address);
    //     assert.equal(balance.valueOf(), expectedSupplierBalanceWei, "bad reserve balance");

    //     //check lower token balance in reserve
    //     let reportedBalance = await token.balanceOf(supplierInst.address);
    //     assert.equal(reportedBalance.valueOf(), reserveTokenBalance[tokenInd].valueOf(), "bad token balance on reserve");

    //     //check token balance on user1
    //     let tokenTweiBalance = await token.balanceOf(user1);
    //     assert.equal(tokenTweiBalance.valueOf(), totalExpectedTwei.valueOf(), "bad token balance");
    // });

    // it("should perform small sell and check: balances changed, rate is expected rate.", async function () {
    //     let tokenInd = 3;
    //     let token = tokens[tokenInd]; //choose some token
    //     let amountTwei = 25 * 1;

    //     //no need to transfer initial balance to user
    //     //in the full scenario. user approves network which collects the tokens and approves reserve
    //     //which collects tokens from network.
    //     //so here transfer tokens to network and approve allowance from network to reserve.
    //     await token.transfer(network, amountTwei);

    //     //verify sell rate
    //     let sellRate = await supplierInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amountTwei, currentBlock);

    //     let expectedRate = (new BigNumber(baseSellRate[tokenInd]));
    //     let extraBps = getExtraBpsForSellQuantity(amountTwei);
    //     expectedRate = addBps(expectedRate, extraBps);
    //     expectedRate.floor();

    //     //check correct rate calculated
    //     assert.equal(sellRate.valueOf(), expectedRate.valueOf(), "unexpected rate.");

    //     //pre trade step, approve allowance from user to network.
    //     await token.approve(supplierInst.address, amountTwei, {from: network});

    //     //perform trade
    //     await supplierInst.trade(tokenAdd[tokenInd], amountTwei, ethAddress, user2, sellRate, true, {from:network});

    //     //check lower ether balance on reserve
    //     let amountWei = (new BigNumber(amountTwei).mul(expectedRate)).div(precisionUnits).floor();
    //     expectedSupplierBalanceWei = (new BigNumber(expectedSupplierBalanceWei)).sub(amountWei).floor();
    //     let balance = await Helper.getBalancePromise(supplierInst.address);
    //     assert.equal(balance.valueOf(), expectedSupplierBalanceWei.valueOf(), "bad reserve balance wei");

    //     //check token balances
    //     ///////////////////////

    //     //check token balance on network zeroed
    //     let tokenTweiBalance = await token.balanceOf(network);

    //     assert.equal(tokenTweiBalance.valueOf(), 0, "bad token balance");

    //     //check token balance on reserve was updated (higher)
    //     //below is true since all tokens and ether have same decimals (18)
    //     reserveTokenBalance[tokenInd] += (amountTwei * 1);
    //     reserveTokenImbalance[tokenInd] -= (amountTwei * 1); //imbalance represents how many missing tokens
    //     let reportedBalance = await token.balanceOf(supplierInst.address);
    //     assert.equal(reportedBalance.valueOf(), reserveTokenBalance[tokenInd].valueOf(), "bad token balance on reserve");
    // });

    // it("should verify trade success when validation disabled.", async function () {
    //     let tokenInd = 3;
    //     let token = tokens[tokenInd]; //choose some token
    //     let amountTwei = 25 * 1;


    //     //no need to transfer initial balance to user
    //     //in the full scenario. user approves network which collects the tokens and approves reserve
    //     //which collects tokens from network.
    //     //so here transfer tokens to network and approve allowance from network to reserve.
    //     await token.transfer(network, amountTwei);

    //     //pre trade step, approve allowance from user to network.
    //     await token.approve(supplierInst.address, amountTwei, {from: network});

    //     //sell rate
    //     let sellRate = await supplierInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amountTwei, currentBlock);

    //     //perform trade
    //     await supplierInst.trade(tokenAdd[tokenInd], amountTwei, ethAddress, user2, sellRate, false, {from:network});

    //     //check lower ether balance on reserve
    //     let amountWei = (new BigNumber(amountTwei).mul(sellRate)).div(precisionUnits).floor();
    //     expectedSupplierBalanceWei = (new BigNumber(expectedSupplierBalanceWei)).sub(amountWei).floor();
    //     let balance = await Helper.getBalancePromise(supplierInst.address);
    //     assert.equal(balance.valueOf(), expectedSupplierBalanceWei.valueOf(), "bad reserve balance wei");

    //     //check token balances
    //     ///////////////////////

    //     //check token balance on network zeroed
    //     let tokenTweiBalance = await token.balanceOf(network);

    //     assert.equal(tokenTweiBalance.valueOf(), 0, "bad token balance");

    //     //check token balance on reserve was updated (higher)
    //     //below is true since all tokens and ether have same decimals (18)
    //     reserveTokenBalance[tokenInd] += (amountTwei * 1);
    //     reserveTokenImbalance[tokenInd] -= (amountTwei * 1); //imbalance represents how many missing tokens
    //     let reportedBalance = await token.balanceOf(supplierInst.address);
    //     assert.equal(reportedBalance.valueOf(), reserveTokenBalance[tokenInd].valueOf(), "bad token balance on reserve");
    // });


    // it("should perform a few sells with steps. check: balances changed, rate is expected rate.", async function () {
    //     let tokenInd = 3;
    //     let token = tokens[tokenInd]; //choose some token

    //     //no need to transfer initial balance to user
    //     //in the full scenario. user approves network which collects the tokens and approves reserve
    //     //which collects tokens from network.
    //     //so here transfer tokens to network and approve allowance from network to reserve.
    //     for (let i = 0; i < 17; ++i)
    //     {
    //         let amountTwei = (i + 1) * 31;

    //         await token.transfer(network, amountTwei);

    //         //verify sell rate
    //         let sellRate = await supplierInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amountTwei, currentBlock);

    //         let expectedRate = (new BigNumber(baseSellRate[tokenInd])).floor();
    //         let extraBps = getExtraBpsForSellQuantity(amountTwei);
    //         expectedRate = addBps(expectedRate, extraBps);
    //         extraBps = getExtraBpsForImbalanceSellQuantity((reserveTokenImbalance[tokenInd] - (amountTwei * 1)));
    //         expectedRate = addBps(expectedRate, extraBps);
    //         expectedRate = expectedRate.floor();

    //         //check correct rate calculated
    //         assert.equal(sellRate.valueOf(), expectedRate.valueOf(), "unexpected rate.");

    //         //pre trade step, approve allowance from network to reserve (on reserve test we skip step where user sends to netwok)
    //         await token.approve(supplierInst.address, amountTwei, {from: network});

    //         //perform trade
    //         await supplierInst.trade(tokenAdd[tokenInd], amountTwei, ethAddress, user2, sellRate, true, {from:network});

    //         //check lower ether balance on reserve
    //         let amountWei = (new BigNumber(amountTwei).mul(expectedRate)).div(precisionUnits).floor();
    //         expectedSupplierBalanceWei = (new BigNumber(expectedSupplierBalanceWei)).sub(amountWei).floor();
    //         let balance = await Helper.getBalancePromise(supplierInst.address);
    //         assert.equal(balance.valueOf(), expectedSupplierBalanceWei.valueOf(), "bad reserve balance wei");

    //         //check token balances
    //         ///////////////////////

    //         //check token balance on network zeroed
    //         let tokenTweiBalance = await token.balanceOf(network);

    //         assert.equal(tokenTweiBalance.valueOf(), 0, "bad token balance network");

    //         //check token balance on reserve was updated (higher)
    //         //below is true since all tokens and ether have same decimals (18)
    //         reserveTokenBalance[tokenInd] += (amountTwei * 1);
    //         reserveTokenImbalance[tokenInd] -= (amountTwei * 1); //imbalance represents how many missing tokens
    //         let reportedBalance = await token.balanceOf(supplierInst.address);
    //         assert.equal(reportedBalance.valueOf(), reserveTokenBalance[tokenInd].valueOf(), "bad token balance on reserve");
    //     }
    // });

    // it("should test sell trade reverted without token approved.", async function () {
    //     let tokenInd = 2;
    //     let token = tokens[tokenInd]; //choose some token
    //     let amount = 300 * 1;

    //     let sellRate = await supplierInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amount, currentBlock);

    //     await token.transfer(network, amount);

    //     //
    //     try {
    //         await supplierInst.trade(tokenAdd[tokenInd], amount, ethAddress, user2, sellRate, true, {from:network});
    //         assert(false, "throw was expected in line above.")
    //     } catch(e){
    //         assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }

    //     //now see success with approve
    //     await token.approve(supplierInst.address, amount, {from: network});
    //     await supplierInst.trade(tokenAdd[tokenInd], amount, ethAddress, user2, sellRate, true, {from:network});
    // });

    // it("should test trade reverted when trade disabled .", async function () {
    //     let tokenInd = 2;
    //     let token = tokens[tokenInd]; //choose some token
    //     let amount = 300 * 1;

    //     let sellRate = await supplierInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amount, currentBlock);

    //     await token.transfer(network, amount);
    //     await token.approve(supplierInst.address, amount, {from: network});

    //     await supplierInst.disableTrade({from:alerter});
    //     //
    //     try {
    //         await supplierInst.trade(tokenAdd[tokenInd], amount, ethAddress, user2, sellRate, true, {from:network});
    //         assert(false, "throw was expected in line above.")
    //     } catch(e){
    //         assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }

    //     await supplierInst.enableTrade({from:admin});
    //     //now see success on same trade when enabled
    //     await supplierInst.trade(tokenAdd[tokenInd], amount, ethAddress, user2, sellRate, true, {from:network});
    // });

    // it("should test trade reverted when conversion rate 0.", async function () {
    //     let tokenInd = 2;
    //     let token = tokens[tokenInd]; //choose some token
    //     let amount = 300 * 1;

    //     let sellRate = await supplierInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amount, currentBlock);

    //     await token.transfer(network, amount);
    //     await token.approve(supplierInst.address, amount, {from: network});

    //     //
    //     try {
    //         await supplierInst.trade(tokenAdd[tokenInd], amount, ethAddress, user2, 0, true, {from:network});
    //         assert(false, "throw was expected in line above.")
    //     } catch(e){
    //         assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }

    //     await supplierInst.trade(tokenAdd[tokenInd], amount, ethAddress, user2, sellRate, true, {from:network});
    // });

    // it("should test trade reverted when dest amount is 0.", async function () {
    //     let tokenInd = 1;
    //     let token = tokens[tokenInd]; //choose some token
    //     let amountLow = 1 * 1;
    //     let amountHigh = 300 * 1;

    //     let sellRate = await supplierInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amountLow, currentBlock);

    //     await token.transfer(network, (amountLow*1 + amountHigh*1));
    //     await token.approve(supplierInst.address, (amountLow*1 + amountHigh*1), {from: network});

    //     //
    //     try {
    //         await supplierInst.trade(tokenAdd[tokenInd], amountLow, ethAddress, user2, sellRate, true, {from:network});
    //         assert(false, "throw was expected in line above.")
    //     } catch(e){
    //         assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }

    //     await supplierInst.trade(tokenAdd[tokenInd], amountHigh, ethAddress, user2, sellRate, true, {from:network});
    //     reserveTokenBalance[tokenInd] = reserveTokenBalance[tokenInd]*1 + amountHigh*1;
    //     reserveTokenImbalance[tokenInd] = reserveTokenImbalance[tokenInd]*1 - amountHigh*1;
    // });

    // it("should test buy trade reverted when not sending correct ether value.", async function () {
    //     let tokenInd = 4;
    //     let token = tokens[tokenInd]; //choose some token
    //     let amount = 3;

    //     let rate = await supplierInst.getConversionRate(ethAddress, tokenAdd[tokenInd], amount, currentBlock);

    //    //test trade reverted when sending wrong ether value
    //     try {
    //         await supplierInst.trade(ethAddress, amount, tokenAdd[tokenInd], user2, rate, true, {from:network, value:1});
    //         assert(false, "throw was expected in line above.")
    //     } catch(e){
    //         assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }

    //     //see it works when sending correct value
    //     await supplierInst.trade(ethAddress, amount, tokenAdd[tokenInd], user2, rate, true, {from:network, value:amount});
    // });

    // it("should test trade reverted when not sent from network.", async function () {
    //     let tokenInd = 4;
    //     let token = tokens[tokenInd]; //choose some token
    //     let amount = 3;
    //     let rate = await supplierInst.getConversionRate(ethAddress, tokenAdd[tokenInd], amount, currentBlock);

    //    //test trade reverted when sending wrong ether value
    //     try {
    //         await supplierInst.trade(ethAddress, amount, tokenAdd[tokenInd], user2, rate, true, {from:operator, value:amount});
    //         assert(false, "throw was expected in line above.")
    //     } catch(e){
    //         assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }

    //     //see same trade works when sending correct value
    //     await supplierInst.trade(ethAddress, amount, tokenAdd[tokenInd], user2, rate, true, {from:network, value:amount});
    // });

    // it("should test trade reverted when sending ether value with sell trade.", async function () {
    //    let tokenInd = 1;
    //    let token = tokens[tokenInd]; //choose some token
    //    let amount = 300 * 1;

    //    let sellRate = await supplierInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amount, currentBlock);

    //    await token.transfer(network, amount);
    //    await token.approve(supplierInst.address, amount, {from: network});

    //    //
    //    try {
    //        await supplierInst.trade(tokenAdd[tokenInd], amount, ethAddress, user2, sellRate, true, {from:network, value:3});
    //        assert(false, "throw was expected in line above.")
    //    } catch(e){
    //        assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //    }

    //    await supplierInst.trade(tokenAdd[tokenInd], amount, ethAddress, user2, sellRate, true, {from:network, value: 0});
    //    reserveTokenBalance[tokenInd] = reserveTokenBalance[tokenInd]*1 + amount*1;
    //    reserveTokenImbalance[tokenInd] = reserveTokenImbalance[tokenInd]*1 - amount*1;
    // });

    // it("should test reverted scenario for set contracts call.", async function () {
    //     //legal call
    //     await supplierInst.setContracts(network, convRatesInst.address, 0, {from:admin});

    //     try {
    //         await supplierInst.setContracts(0, convRatesInst.address, 0, {from:admin});
    //         assert(false, "throw was expected in line above.")
    //     } catch(e){
    //         assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }

    //     try {
    //         await supplierInst.setContracts(network, 0, 0, {from:admin});
    //         assert(false, "throw was expected in line above.")
    //     } catch(e){
    //         assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }
    // });

    // it("should test get src qty when dst qty is very small and source is near 0.", async function () {
    //     //legal call
    //     let token3Dec = await TestToken.new("test", "tst", 3);
    //     let dstQty = 200;
    //     let rate = precisionUnits / 2;

    //     //make sure src qty rounded up.
    //     let getSrcQTY = await supplierInst.getSrcQty(token3Dec.address, ethAddress, dstQty, rate);
    //     let calcSrcQty = (new BigNumber(10)).pow(3 - 18).mul(precisionUnits).mul(dstQty).div(rate).ceil();
    //     assert.equal(calcSrcQty.valueOf(), getSrcQTY.valueOf(), "bad src qty");

    //     getSrcQTY = await supplierInst.getSrcQty(ethAddress, token3Dec.address, dstQty, rate);
    //     calcSrcQty = (precisionUnits / rate ) * dstQty / ((10 ** (3 - 18)));;
    //     assert.equal(calcSrcQty.valueOf(), getSrcQTY.valueOf(), "bad src qty");

    // });

    // it("should test get src qty reverted when decimals diff > max decimals diff (18).", async function () {
    //     //max decimal diff is defined in contract Utils.sol MAX_DECIMALS
    //     let token3Dec = await TestToken.new("test", "tst", 3);
    //     let token30Dec = await TestToken.new("test", "tst", 30);
    //     let dstQty = 300;
    //     let rate = precisionUnits / 2;

    //     //first get src qty when decimal diff is legal
    //     getSrcQTY = await supplierInst.getSrcQty(ethAddress, token3Dec.address, dstQty, rate);
    //     calcSrcQty = (precisionUnits / rate ) * dstQty / ((10 ** (3 - 18)));;
    //     assert.equal(calcSrcQty.valueOf(), getSrcQTY.valueOf(), "bad src qty");

    //     getSrcQTY = await supplierInst.getSrcQty(ethAddress, token3Dec.address, dstQty, rate);
    //     calcSrcQty = (precisionUnits / rate ) * dstQty / ((10 ** (3 - 18)));;
    //     assert.equal(calcSrcQty.valueOf(), getSrcQTY.valueOf(), "bad src qty");

    //     //see reverted when qty decimal diff > max decimal diff
    //     try {
    //        getSrcQTY = await supplierInst.getSrcQty(token30Dec.address, token3Dec.address, dstQty, rate);
    //        assert(false, "throw was expected in line above.")
    //     } catch(e){
    //        assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }

    //     //see reverted when qty diff > max diff
    //     try {
    //        getSrcQTY = await supplierInst.getSrcQty(token3Dec.address, token30Dec.address, dstQty, rate);
    //        assert(false, "throw was expected in line above.")
    //     } catch(e){
    //        assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }
    // });

    // it("should approve withdraw address and withdraw. token and ether", async function () {
    //     let tokenInd = 1;
    //     let amount = 10;
    //     let token = tokens[tokenInd];

    //     // first token
    //     await supplierInst.approveWithdrawAddress(tokenAdd[tokenInd], withDrawAddress, true);
    //     await supplierInst.withdraw(tokenAdd[tokenInd], amount, withDrawAddress, {from: operator});

    //     reserveTokenBalance[tokenInd] -= amount;
    //     let reportedBalance = await token.balanceOf(supplierInst.address);
    //     assert.equal(reportedBalance.valueOf(), reserveTokenBalance[tokenInd].valueOf(), "bad token balance on reserve");

    //     reportedBalance = await token.balanceOf(withDrawAddress);
    //     assert.equal(reportedBalance.valueOf(), amount, "bad token balance on withdraw address");

    //     expectedSupplierBalanceWei = await Helper.getBalancePromise(supplierInst.address);

    //     //ether
    //     await supplierInst.approveWithdrawAddress(ethAddress, withDrawAddress, true);
    //     await supplierInst.withdraw(ethAddress, amount, withDrawAddress, {from: operator});

    //     expectedSupplierBalanceWei -= amount;
    //     reportedBalance = await Helper.getBalancePromise(supplierInst.address);
    //     assert.equal(reportedBalance.valueOf(), expectedSupplierBalanceWei, "bad eth balance on reserve");
    // });

    // it ("should test reverted scenarios for withdraw", async function() {
    //     let tokenInd = 1;
    //     let amount = 10;

    //     //make sure withdraw reverted from non operator
    //     try {
    //         await supplierInst.withdraw(tokenAdd[tokenInd], amount, withDrawAddress);
    //         assert(false, "throw was expected in line above.")
    //     }
    //     catch(e){
    //         assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }

    //     //make sure withdraw reverted to non approved token
    //     try {
    //         await supplierInst.withdraw(tokenAdd[tokenInd - 1], amount, withDrawAddress, {from: operator});
    //         assert(false, "throw was expected in line above.")
    //     }
    //     catch(e){
    //         assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }

    //     //make sure withdraw reverted to non approved address
    //     try {
    //         await supplierInst.withdraw(tokenAdd[tokenInd], amount, accounts[9], {from: operator});
    //         assert(false, "throw was expected in line above.")
    //     }
    //     catch(e){
    //         assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }
    // });

    // it ("should test get dest qty", async function() {
    //     let srcQty = 100;
    //     let rate = precision.div(2); //1 to 2. in precision units

    //     let srcDecimal = 10;
    //     let dstDecimal = 13;

    //     let tokenA = await TestToken.new("source", "src", srcDecimal);
    //     let tokenB = await TestToken.new("dest", "dst", dstDecimal);

    //     //get dest QTY
    //     let expectedDestQty = (srcQty * rate / precision) * (10 ** (dstDecimal - srcDecimal));

    //     let reportedDstQty = await supplierInst.getDestQty(tokenA.address, tokenB.address, srcQty, rate);

    //     assert.equal(expectedDestQty.valueOf(), reportedDstQty.valueOf(), "unexpected dst qty");
    // });

    // it ("should test get src qty", async function() {
    //     let rate = precision.div(2); //1 to 2. in precision units

    //     let srcDecimal = 10;
    //     let dstDecimal = 13;

    //     let tokenA = await TestToken.new("source", "src", srcDecimal);
    //     let tokenB = await TestToken.new("dest", "dst", dstDecimal);

    //     //get src qty
    //     let dstQty = 100000;
    //     let expectedSrcQty = (((precision / rate)* dstQty * (10**(srcDecimal - dstDecimal))));

    //     let reportedSrcQty = await supplierInst.getSrcQty(tokenA.address, tokenB.address, dstQty, rate);

    //     assert.equal(expectedSrcQty.valueOf(), reportedSrcQty.valueOf(), "unexpected dst qty");
    // });

    // it ("should test get conversion rate options", async function() {
    //     let tokenInd = 3;
    //     let amountTwei = 3;

    //     //test normal case.
    //     let sellRate = await supplierInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amountTwei, currentBlock);

    //     let expectedRate = (new BigNumber(baseSellRate[tokenInd])).floor();
    //     let extraBps = getExtraBpsForSellQuantity(amountTwei);
    //     expectedRate = addBps(expectedRate, extraBps);
    //     extraBps = getExtraBpsForImbalanceSellQuantity((reserveTokenImbalance[tokenInd] - (amountTwei * 1)));
    //     expectedRate = addBps(expectedRate, extraBps);
    //     expectedRate = expectedRate.floor();

    //     //check correct rate calculated
    //     assert.equal(sellRate.valueOf(), expectedRate.valueOf(), "unexpected rate.");

    //     //disable trade and test
    //     await supplierInst.disableTrade({from: alerter})
    //     sellRate = await supplierInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amountTwei, currentBlock);
    //     assert.equal(0, sellRate.valueOf(), "rate not 0");
    //     await supplierInst.enableTrade({from:admin});

    //     //try token to token
    //     sellRate = await supplierInst.getConversionRate(tokenAdd[tokenInd], tokenAdd[2], amountTwei, currentBlock);
    //     assert.equal(0, sellRate.valueOf(), "rate not 0");

    //     //test normal case.
    //     sellRate = await supplierInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amountTwei, currentBlock);

    //     //check correct rate calculated
    //     assert.equal(sellRate.valueOf(), expectedRate.valueOf(), "unexpected rate.");
    // });

    // it ("should test get conversion rate return 0 when sanity rate is lower the calculated rate", async function() {
    //     let tokenInd = 1;
    //     let token = tokens[tokenInd]; //choose some token
    //     let amount = 30 * 1;

    //     let sellRate = await supplierInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amount, currentBlock);

    //     await token.transfer(network, amount);
    //     await token.approve(supplierInst.address, amount, {from: network});

    //     //set sanity rate data...
    //     sanityRate = await SanityRates.new(admin);
    //     await sanityRate.addOperator(operator);
    //     let tokens2 = [tokenAdd[tokenInd]];

    //     //set low rate - that will be smaller then calculated and cause return value 0
    //     let rates2 = [new BigNumber(sellRate).div(2).floor()];

    //     await sanityRate.setSanityRates(tokens2, rates2, {from: operator});
    //     let diffs = [1000];
    //     await sanityRate.setReasonableDiff(tokens2, diffs, {from: admin});

    //     await supplierInst.setContracts(network, convRatesInst.address, sanityRate.address, {from:admin});

    //     let nowRate = await supplierInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amount, currentBlock);

    //     assert.equal(nowRate.valueOf(), 0, "expected zero rate.");

    //     //set high sanity rate. that will not fail the calculated rate.
    //     rates2 = [new BigNumber(sellRate).mul(2).floor()];
    //     await sanityRate.setSanityRates(tokens2, rates2, {from: operator});
    //     nowRate = await supplierInst.getConversionRate(tokenAdd[tokenInd], ethAddress, amount, currentBlock);
    //     assert(nowRate.valueOf() > 0, "expected valid rate.");
    //     await supplierInst.setContracts(network, convRatesInst.address, 0, {from:admin});
    // });

    // it("should zero reserve balance and see that get rate returns zero when not enough dest balance", async function() {
    //     let tokenInd = 1;
    //     let amountTwei = maxPerBlockImbalance - 1;
    //     let token = tokens[tokenInd];
    //     let srcQty = 50; //some high number of figure out ~rate


    //     let balance = await token.balanceOf(supplierInst.address);
    //     await supplierInst.approveWithdrawAddress(tokenAdd[tokenInd], withDrawAddress, true);
    //     await supplierInst.withdraw(tokenAdd[tokenInd], balance, withDrawAddress, {from: operator});

    //     balance = await token.balanceOf(supplierInst.address);

    //     assert.equal(balance.valueOf(0), 0, "expected balance 0");

    //     let rate = await supplierInst.getConversionRate(ethAddress, tokenAdd[tokenInd], srcQty, currentBlock);
    //     assert.equal(rate.valueOf(), 0, "expected rate 0");
    // });

    // it("should test can't init this contract with empty contracts (address 0).", async function () {
    //     let reserve;

    //     try {
    //        reserve = await Supplier.new(network, convRatesInst.address, 0);
    //        assert(false, "throw was expected in line above.")
    //     } catch(e){
    //        assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }

    //     try {
    //        reserve =  await Supplier.new(network, 0, admin);
    //        assert(false, "throw was expected in line above.")
    //     } catch(e){
    //        assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }

    //     try {
    //        reserve =  await Supplier.new(0, convRatesInst.address, admin);
    //        assert(false, "throw was expected in line above.")
    //     } catch(e){
    //        assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }

    //     reserve = await Supplier.new(network, convRatesInst.address, admin);

    //     try {
    //        await reserve.setContracts(0, convRatesInst.address, 0);
    //        assert(false, "throw was expected in line above.")
    //     } catch(e){
    //        assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }

    //     try {
    //        await reserve.setContracts(network, 0, 0);
    //        assert(false, "throw was expected in line above.")
    //     } catch(e){
    //        assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
    //     }

    //     //sanity rates can currently be empty
    //     await reserve.setContracts(network, convRatesInst.address, 0);
    // });
});

function convertRateToPricingRate (baseRate) {
// conversion rate in pricing is in precision units (10 ** 18) so
// rate 1 to 50 is 50 * 10 ** 18
// rate 50 to 1 is 1 / 50 * 10 ** 18 = 10 ** 18 / 50a
    return ((new BigNumber(10).pow(18)).mul(baseRate).floor());
};

function getExtraBpsForBuyQuantity(qty) {
    for (let i = 0; i < qtyBuyStepX.length; i++) {
        if (qty <= qtyBuyStepX[i]) return qtyBuyStepY[i];
    }
    return qtyBuyStepY[qtyBuyStepY.length - 1];
};

function getExtraBpsForSellQuantity(qty) {
    for (let i = 0; i < qtySellStepX.length; i++) {
        if (qty <= qtySellStepX[i]) return qtySellStepY[i];
    }
    return qtySellStepY[qtySellStepY.length - 1];
};

function getExtraBpsForImbalanceBuyQuantity(qty) {
    for (let i = 0; i < imbalanceBuyStepX.length; i++) {
        if (qty <= imbalanceBuyStepX[i]) return imbalanceBuyStepY[i];
    }
    return (imbalanceBuyStepY[imbalanceBuyStepY.length - 1]);
};

function getExtraBpsForImbalanceSellQuantity(qty) {
    for (let i = 0; i < imbalanceSellStepX.length; i++) {
        if (qty <= imbalanceSellStepX[i]) return imbalanceSellStepY[i];
    }
    return (imbalanceSellStepY[imbalanceSellStepY.length - 1]);
};

function addBps (price, bps) {
    return (price.mul(10000 + bps).div(10000));
};

function compareRates (receivedRate, expectedRate) {
    expectedRate = expectedRate - (expectedRate % 10);
    receivedRate = receivedRate - (receivedRate % 10);
    assert.equal(expectedRate, receivedRate, "different prices");
};