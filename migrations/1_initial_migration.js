var Migrations = artifacts.require("./Migrations.sol");
var TestToken = artifacts.require("./TestToken.sol");
var OneClickTrade = artifacts.require("./MartletInstantlyTrader.sol");
var ConversionRates = artifacts.require("./ConversionAgent.sol");
var Supplier = artifacts.require("./Supplier.sol");
var WhiteList = artifacts.require("./WhiteList.sol");

module.exports = function(deployer) {
	accounts = web3.eth.accounts;
  deployer.deploy(Migrations);
    deployer.deploy(TestToken, "TEST", 'TST', 18);
  deployer.deploy(OneClickTrade, accounts[2]).then(function(){
  	return deployer.deploy(ConversionRates, accounts[1]);
  }).then(function(){
  	deployer.deploy(Supplier, OneClickTrade.address, ConversionRates.address, accounts[0]);
  });
};
