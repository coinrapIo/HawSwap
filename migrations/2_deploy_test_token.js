var TestToken = artifacts.require("./TestToken.sol");

module.exports = function(deployer, network, accounts) {
  deployer.then(async() =>{
let t2 = await deployer.deploy(TestToken, "TEST2", 'TST2', 18);
let t3 = await deployer.deploy(TestToken, "TEST3", 'TST3', 18);
let t4 = await deployer.deploy(TestToken, "TEST4", 'TST4', 18);
console.log("t2:", t2.address, "t3:", t3.address, "t4:", t4.address);
  })};