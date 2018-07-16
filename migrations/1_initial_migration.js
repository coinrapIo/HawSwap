var Migrations = artifacts.require("./Migrations.sol");

module.exports = function(deployer, accounts) {
	// accounts = web3.eth.accounts;
  deployer.deploy(Migrations);
  //.then(function(){
  //   return deployer.deploy(TestToken, "TEST", 'TST', 18);
  // }).then(function(){
  //   return deployer.deploy(OneClickTrade, accounts[2]);
  // }).then(function(){
  //   return deployer.deploy(ConversionRates, accounts[1]);
  // }).then(function(){
  //   return deployer.deploy(Supplier, OneClickTrade.address, ConversionRates.address, accounts[0]);
  // }).then(function(){
  //   return deployer.deploy(WhiteList, accounts[0], TestToken.address);
  // })
};

