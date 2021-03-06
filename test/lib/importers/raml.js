var expect   = require('chai').expect,
    RAML = require('../../../lib/importers/raml'),
    Project = require('../../../lib/entities/project');

describe('RAML Importer', function(){
  var ramlImporter, filePath = __dirname+'/../../data/raml.yaml';
  beforeEach(function(){
    ramlImporter = new RAML();
  });

  describe('constructor', function(){
    it('should return new RAML importer instance successfully', function(){
      expect(ramlImporter).to.be.instanceOf(RAML);
    });
    it('should possess generic importer prototype', function(){
      expect(ramlImporter).to.respondTo('loadFile');
      expect(ramlImporter).to.respondTo('loadData');
      expect(ramlImporter).to.respondTo('_import');
      expect(ramlImporter).to.respondTo('import');
    });
  });
  describe('loadFile', function(){
    it('should be able to load a valid yaml file', function(done){
      ramlImporter.loadFile(filePath, function(){
        done();
      });
    });
    it('should return error for invalid file', function(done){
      ramlImporter.loadFile(__dirname+'/../../data/invalid/raml.yaml', function(err){
        expect(err).not.to.be.undefined;
        expect(err.message).to.equal('The first line must be: \'#%RAML 0.8\'');
        done();
      });
    });
  });
  describe('import', function(){
    it('should perform import operation on loaded data', function(done){
      ramlImporter.loadFile(filePath, function(){
        try {
          var slProject = ramlImporter.import();
          expect(slProject).to.be.instanceOf(Project);
          expect(slProject.Endpoints.length).to.gt(0);
          done();
        }
        catch(err){
          done(err);
        }
      });
    });
  });

  //TODO write test for internal functions
  describe('_mapHost', function(){
    it('should map empty host as null', function(){
      var importer = new RAML();
      importer.project = new Project('test');
      importer.data = {
        baseUri: undefined
      };
      importer._mapHost();
      expect(importer.project.Environment.Host).to.be.equal(null);
    });
  });


  //TODO write test for internal functions
  describe('_mapSchema', function(){
    it('should map schema data successfully');
  });

  describe('_mapQueryString', function(){
    it('should map query string data successfully');
  });

  describe('_mapURIParams', function(){
    it('should map uri params data successfully');
  });

  describe('_mapRequestBody', function(){
    it('should map request body data successfully');
  });

  describe('_mapResponseBody', function(){
    it('should map response body data successfully');
  });

  describe('_mapRequestHeaders', function(){
    it('should map request header data successfully');
  });
});
