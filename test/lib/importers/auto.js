var expect   = require('chai').expect,
    Auto = require('../../../lib/importers/auto'),
    Project = require('../../../lib/entities/project');

describe('Auto Importer', function(){
  var autoImporter;
  beforeEach(function(){
    autoImporter = new Auto();
  });
  describe('constructor', function(){
    it('should return new postman importer instance successfully', function(){
      expect(autoImporter).to.be.instanceOf(Auto);
    });
    it('should possess generic importer prototype', function(){
      expect(autoImporter).to.respondTo('loadFile');
      expect(autoImporter).to.respondTo('loadData');
      expect(autoImporter).to.respondTo('_import');
      expect(autoImporter).to.respondTo('import');
    });
  });
  describe('loadFile', function(){
    it('should be able to load a valid postman json file', function(done){
      autoImporter.loadFile(__dirname+'/../../data/postman.json', function(err){
        expect(err).to.be.equal(undefined);
        var slProject = autoImporter.import();
        expect(slProject).to.be.instanceOf(Project);
        expect(slProject.Endpoints.length).to.gt(0);
        done();
      });
    });
    it('should return error for invalid json file', function(done){
      autoImporter.loadFile(__dirname+'/../../data/invalid/postman.json', function(err){
        expect(err).to.not.equal(undefined);
        done();
      });
    });
    it('should be able to load a valid swagger json file', function(done){
      autoImporter.loadFile(__dirname+'/../../data/swagger.json', function(err){
        expect(err).to.be.equal(undefined);
        var slProject = autoImporter.import();
        expect(slProject).to.be.instanceOf(Project);
        expect(slProject.Endpoints.length).to.gt(0);
        done();
      });
    });
    it('should be able to load a valid swagger yaml file', function(done){
      autoImporter.loadFile(__dirname+'/../../data/swagger.yaml', function(err){
        expect(err).to.be.equal(undefined);
        var slProject = autoImporter.import();
        expect(slProject).to.be.instanceOf(Project);
        expect(slProject.Endpoints.length).to.gt(0);
        done();
      });
    });
    it('should be able to load a valid raml yaml file', function(done){
      autoImporter.loadFile(__dirname+'/../../data/raml.yaml', function(err){
        expect(err).to.be.equal(undefined);
        var slProject = autoImporter.import();
        expect(slProject).to.be.instanceOf(Project);
        expect(slProject.Endpoints.length).to.gt(0);
        done();
      });
    });
    it('should be able to load a remote swagger url', function(done){
      autoImporter.loadFile('http://petstore.swagger.io/v2/swagger.json', function(err){
        expect(err).to.be.equal(undefined);
        var slProject = autoImporter.import();
        expect(slProject).to.be.instanceOf(Project);
        expect(slProject.Endpoints.length).to.gt(0);
        done();
      });
    });
  });
  describe('_import', function(){
    it('should perform import operation on loaded data', function(){
      autoImporter.loadFile(__dirname+'/../../data/stoplightx.json', function(err){
        expect(err).to.be.equal(undefined);
        var slProject = autoImporter.import();
        expect(slProject).to.be.instanceOf(Project);
        expect(slProject.Endpoints.length).to.gt(0);
      });
    });
  });
  describe('getDetectedFormat', function(){
    it('should return detected format', function(){
      autoImporter.loadFile(__dirname+'/../../data/stoplightx.json', function(err){
        expect(err).to.be.equal(undefined);
        expect(autoImporter.getDetectedFormat()).to.be.equal('STOPLIGHTX');
        expect(autoImporter.detectedFormat).to.be.equal('STOPLIGHTX');
      });
    });
  });
});
