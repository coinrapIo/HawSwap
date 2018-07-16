let CoinRap = artifacts.require("MartletInstantlyTrader");
let ConversionAgent = artifacts.require("ConversionAgent");
let TestToken = artifacts.require("TestToken");

let Helper = require("./helper.js");
let BigNumber = require('bignumber.js');
// let web3 = require('web3')

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
const tokenAddr = '0x6606d3f6b8fc555e4613e044f31f5f740b8c7ae1';
const coinRapAddr = "0x472d00e2993c510e972c92b9e7320bc727af47d9";
const pricing1Addr = "0x808a21d86388ff563598f0f3bbf5ea732d831ff8";

module.exports = function(){
    async function setForDapp(){
        let coinrap = await CoinRap.at(coinRapAddr);
        let pricing1 = await ConversionAgent.at(pricing1Addr);
        let token = await TestToken.at(tokenAddr);
        currentBlock = priceUpdateBlock = 2616626;
        tokens[0] = token;
        tokenAdd[0] = token.address;

        await pricing1.setValidRateDurationInBlocks(validRateDurationInBlocks);
        await pricing1.addToken(token.address);
        await pricing1.setTokenControlInfo(token.address, minimalRecordResolution, maxPerBlockImbalance, maxTotalImbalance);
        await pricing1.enableTokenTrade(token.address);

        // result = await pricing1.addOperator(operator);
        console.log(accounts);
        
    }

    setForDapp();
}