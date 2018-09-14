let ConversionAgent = artifacts.require("./ConversionAgent.sol");
let TestToken = artifacts.require("./mockContracts/TestToken.sol");
let Supplier = artifacts.require("./Supplier.sol");
let Network = artifacts.require("./MartletInstantlyTrader.sol");
let WhiteList = artifacts.require("./WhiteList.sol");
let ExpectedRate = artifacts.require("./ExpectedRate.sol");

let Helper = require("./helper.js");
let BigNumber = require('bignumber.js');
let web3 = require('web3')


//global variables
//////////////////
let precisionUnits = (new BigNumber(10).pow(18));
let ethAddress = '0x00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
let gasPrice = (new BigNumber(10).pow(9).mul(50));
let negligibleRateDiff = 15;

//permission groups
let admin;
let operator;
let Quoter;
let sanityRates;
let user1;
let user2;


//contracts
let pricing1;
let pricing2;
let reserve1;
let reserve2;
let whiteList;
let expectedRate;
let network;


//block data
let priceUpdateBlock;
let currentBlock;
let validRateDurationInBlocks = 5000;

let tokens = [];
let tokenAdd = [];


// imbalance data
let minimalRecordResolution = 2; //low resolution so I don't lose too much data. then easier to compare calculated imbalance values.
let maxPerBlockImbalance = 4000;
let maxTotalImbalance = maxPerBlockImbalance * 12;


//base buy and sell rates (prices)
let baseBuyRate1 = [];
let baseBuyRate2 = [];
let baseSellRate1 = [];
let baseSellRate2 = [];

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

//token1 address
const tokenAddr = '0x3a4dee7c6f0cf8402c8b9b4109b2b775aa3e2f47';

contract('MartletInstantlyTrader.init_params', function(accounts){
    it("1111", async function(){ 
        // console.log(accounts[0], "|", accounts[1], "|", accounts[2], "|", accounts[3]);
        admin = accounts[0];
        operator = accounts[1];
        Quoter = accounts[2];
        user1 = accounts[4];
        user2 = accounts[5];
        
        currentBlock = priceUpdateBlock = await Helper.getCurrentBlock();
        pricing1 = await ConversionAgent.deployed();
        // console.log("pricing1:", pricing1);
        
        //set pricing general parameters
        await pricing1.setValidRateDurationInBlocks(validRateDurationInBlocks);

        let token;
        TestToken.deployed().then(async instance => {
            // console.log(instance.abi);
            const contract = web3.eth.contract(instance.abi);
            token = contract.at(tokenAddr);
            tokens[0] = token;
            tokenAdd[0] = token.address;
            console.log("token.address", token.address);
            
            await pricing1.addToken(token.address);
            await pricing1.setTokenControlInfo(token.address, minimalRecordResolution, maxPerBlockImbalance, maxTotalImbalance);
            await pricing1.enableTokenTrade(token.address);
        });

        

        let result = await pricing1.addOperator(operator);
    


        let tokensPerEther;
        let ethersPerToken;
        let i = 0;
        tokensPerEther = (new BigNumber(precisionUnits.mul((i + 1) * 3)).floor());
        ethersPerToken = (new BigNumber(precisionUnits.div((i + 1) * 3)).floor());
        baseBuyRate1.push(tokensPerEther.valueOf());
        baseBuyRate2.push(tokensPerEther.valueOf() * 10100 / 10000);
        baseSellRate1.push(ethersPerToken.valueOf());
        baseSellRate2.push(ethersPerToken.valueOf()  * 10000 / 10300);
        assert.equal(baseBuyRate1.length, tokens.length);
        assert.equal(baseBuyRate2.length, tokens.length);
        assert.equal(baseSellRate1.length, tokens.length);
        assert.equal(baseSellRate2.length, tokens.length);

        buys.length = sells.length = indices.length = 0;
        await pricing1.setBaseRate(tokenAdd, baseBuyRate1, baseSellRate1, buys, sells, currentBlock, indices, {from: operator});

        //set compact data
        compactBuyArr = [0, 0, 0, 0, 0, 06, 07, 08, 09, 10, 11, 12, 13, 14];
        let compactBuyHex = Helper.bytesToHex(compactBuyArr);
        buys.push(compactBuyHex);

        compactSellArr = [0, 0, 0, 0, 0, 26, 27, 28, 29, 30, 31, 32, 33, 34];
        let compactSellHex = Helper.bytesToHex(compactSellArr);
        sells.push(compactSellHex);

        indices[0] = 0;

        assert.equal(indices.length, sells.length, "bad sells array size");
        assert.equal(indices.length, buys.length, "bad buys array size");

        await pricing1.setCompactData(buys, sells, currentBlock, indices, {from: operator});
        
        await pricing1.setQtyStepFunction(tokenAdd[i], qtyBuyStepX, qtyBuyStepY, qtySellStepX, qtySellStepY, {from:operator});
        await pricing1.setImbalanceStepFunction(tokenAdd[i], imbalanceBuyStepX, imbalanceBuyStepY, imbalanceSellStepX, imbalanceSellStepY, {from:operator});


        network = await Network.deployed();
        await network.addOperator(operator);
        reserve1 = await Supplier.deployed();
        const supplierAddress = reserve1.address;
        console.log("supplierAddress", supplierAddress);
        await pricing1.setSupplierAddress(reserve1.address);
        await reserve1.addQuoter(Quoter);

        //set reserve balance. 10000 wei ether + per token 1000 wei ether value according to base rate.
        let reserveEtherInit = 5000 * 2;
        
        await Helper.sendEtherWithPromise(accounts[8], reserve1.address, reserveEtherInit);
        let balance = await Helper.getBalancePromise(reserve1.address);
        expectedSupplier1BalanceWei = balance.valueOf();
        console.log("balance:", balance);
        assert.equal(balance.valueOf(), reserveEtherInit, "wrong ether balance");

        let amount1 = (new BigNumber(reserveEtherInit)).div(precisionUnits).mul(baseBuyRate1[i]).floor();
        console.log(tokenAddr,"%%%%%", supplierAddress);
        await token.transfer(supplierAddress, amount1.valueOf()); 
        // assert.equal(amount1.valueOf(), balance.valueOf());
        // reserve1TokenBalance.push(amount1);
        // reserve1TokenImbalance.push(0);


        // await network.addSupplier(reserve1.address, true);

        // whiteList = WhiteList.deployed();
        // await whiteList.addOperator(operator);
        // await whiteList.setCategoryCap(0, 1000, {from:operator});
        // await whiteList.setSgdToEthRate(30000, {from:operator});

        // // let wei = await whiteList.getUserCapInWei(user2);
        // // console.log("whiteList:", user2, ":", wei);

        // expectedRate = await ExpectedRate.deployed();
        // await network.setParams(whiteList.address, expectedRate.address, gasPrice.valueOf(), negligibleRateDiff);
        // await network.setEnable(true);
        // let price = await network.maxGasPrice();
        // assert.equal(price.valueOf(), gasPrice.valueOf());
    });
})



priceInstance.setValidRateDurationInBlocks(2546990, function(err,result){console.log(result)})
0x5c0316f6c446474d159961cd2ac7251548cb47680f5637d0d766f6509b217a50
22:05:38.207 priceInstance.validRateDurationInBlocks(function(err, result){console.log("xxxxxxxxx", result.toNumber())})
22:05:38.213 xxxxxxxxx r {s: 1, e: 6, c: Array(1)}c: [2546990]e: 6s: 1__proto__: Object



priceInstance.addToken(t1.address, function(err, result){console.log(result);})
let minimalRecordResolution = 2; //low resolution so I don't lose too much data. then easier to compare calculated imbalance values.
let maxPerBlockImbalance = 4000;
let maxTotalImbalance = maxPerBlockImbalance * 12;
priceInstance.setTokenControlInfo(t1.address, minimalRecordResolution, maxPerBlockImbalance, maxTotalImbalance, function(err, result){if(result){console.log(result);}});
priceInstance.enableTokenTrade(t1.address, function(err, result){console.log(result);});

let operator = "0xF14D14A6a04BDd976b73AB0DAa60466c01AD7e58"
priceInstance.addOperator(operator, function(err,result){console.log(result);});


//base buy and sell rates (prices)
let baseBuyRate1 = [];
let baseBuyRate2 = [];
let baseSellRate1 = [];
let baseSellRate2 = [];
let precisionUnits = (new BigNumber(10).pow(18));

let tokensPerEther;
        let ethersPerToken;
        let i = 0;
        tokensPerEther = (new BigNumber(precisionUnits.mul((i + 1) * 3)).floor());
        ethersPerToken = (new BigNumber(precisionUnits.div((i + 1) * 3)).floor());
        baseBuyRate1.push(tokensPerEther.valueOf());
        baseSellRate1.push(ethersPerToken.valueOf());
        
        //compact data.
let sells = [];
let buys = [];
let indices = [];
let compactBuyArr = [];
let compactSellArr = [];
        buys.length = sells.length = indices.length = 0;
        web3.eth.getBlockNumber(function(err, result){console.log(result);});
priceInstance.setBaseRate([t1.address], baseBuyRate1, baseSellRate1, buys, sells, 2620776, indices, function(err, res){console.log("res", res);})

priceInstance.setBaseRate([t1.address, t2.address, t3.address, t4.address], baseBuyRate1, baseSellRate1, buys, sells, 2620776, indices, function(err, res){console.log("res", res);})



function toHexString(byteArray) {
  return Array.from(byteArray, function(byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('')
};

const bytesToHex = function (byteArray) {
    let strNum = toHexString(byteArray);
    let num = '0x' + strNum;
    return num;
};


//set compact data
        compactBuyArr = [0, 0, 0, 0, 0, 6, 7, 8, 9, 10, 11, 12, 13, 14];
        compactBuyHex = bytesToHex(compactBuyArr);
        buys.push(compactBuyHex);

        compactSellArr = [0, 0, 0, 0, 0, 26, 27, 28, 29, 30, 31, 32, 33, 34];
        compactSellHex = bytesToHex(compactSellArr);
        sells.push(compactSellHex);

        indices[0] = 0;

priceInstance.setCompactData(buys, sells, 2563360, indices, function(err, result){console.log(result)});



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


priceInstance.setQtyStepFunction(t1.address, qtyBuyStepX, qtyBuyStepY, qtySellStepX, qtySellStepY, {from:operator}, function(err,result){console.log(result);});

priceInstance.setImbalanceStepFunction(t1.address, imbalanceBuyStepX, imbalanceBuyStepY, imbalanceSellStepX, imbalanceSellStepY, {from:operator}, function(err,result){console.log(result);});



mitInstance.addOperator(operator, function(err, result){console.log(result);})
priceInstance.setSupplierAddress(supplier.address, function(err, res){console.log(res);})
supplier.addOperator(operator, function(err,res){console.log(res);})



const sendEtherWithPromise = function( sender, recv, amount ) {
    return new Promise(function(fulfill, reject){
            web3.eth.sendTransaction({to: recv, from: sender, value: amount}, function(error, result){
            if( error ) {
                return reject(error);
            }
            else {
                return fulfill(true);
            }
        });
    });
};

const getBalancePromise = function( account ) {
    return new Promise(function (fulfill, reject){
        web3.eth.getBalance(account,function(err,result){
            if( err ) reject(err);
            else fulfill(result);
        });
    });
};
let reserveEtherInit = 5000 * 2;
web3.eth.getBalance(supplier.address, function(err, result){console.log(result.toNumber());})

sendEtherWithPromise(web3.eth.accounts[0], supplier.address, reserveEtherInit)

web3.eth.getBalance(supplier.address, function(err, result){console.log(result.toNumber());})

let amount1 = (new BigNumber(reserveEtherInit)).div(precisionUnits).mul(baseBuyRate1[0]).floor();

whiteList.addOperator(operator, function(err, result){console.log(result);})

whiteList.setCategoryCap(0, 1000, {from:operator}, function(err, result){console.log(result);});

whiteList.setSgdToEthRate(30000, {from:operator}, function(err, result){console.log(result);});

whiteList.setUserCategory("0x4ccf8b5c4b53b06216397e79b3d658d2cb08edee", 2, {from: operator}, function(err,result){console.log(result);});

whiteList.getUserCapInWei('0x4ccf8b5c4b53b06216397e79b3d658d2cb08edee', function(err,result){console.log(result.toNumber());});

mitInstance.setParams(whiteList.address, expectedRate.address, gasPrice.valueOf(), negligibleRateDiff, function(err, result){console.log(result);});

mitInstance.setEnable(true, function(err,result){console.log(result);});

mitInstance.listPairForSupplier(supplier.address, ethAddress, t1.address, true, function(err, result){console.log(result);});

mitInstance.listPairForSupplier(supplier.address, t1.address, ethAddress, true, function(err, result){console.log(result);});

let amountWei = 4 * 1;

