var TestToken = artifacts.require("./TestToken.sol");
var OneClickTrade = artifacts.require("./MartletInstantlyTrader.sol");
var ConversionRates = artifacts.require("./ConversionAgent.sol");
var Supplier = artifacts.require("./Supplier.sol");
var SanityRate = artifacts.require("./SanityRates.sol");
var ExpectedRate = artifacts.require("./ExpectedRate.sol");
var WhiteList = artifacts.require("./WhiteList.sol");
var Wrapper = artifacts.require("./Wrapper.sol");

module.exports = function(deployer, network, accounts) {
  deployer.then(async() =>{
    console.log("accounts[0]", accounts[0]);
    let t1 = await deployer.deploy(TestToken, "TEST", 'TST', 18);
    console.log("t1:", t1.address);
    await deployer.deploy(OneClickTrade, accounts[0]);
    await deployer.deploy(ConversionRates, accounts[0]);
    await deployer.deploy(ExpectedRate, OneClickTrade.address, accounts[0]);
    await deployer.deploy(Supplier, OneClickTrade.address, ConversionRates.address, accounts[0]);
    await deployer.deploy(SanityRate, accounts[0]);
    await deployer.deploy(WhiteList, accounts[0], t1.address);
    await deployer.deploy(Wrapper);
    console.log("t11111:", t1.address);
  })
}
