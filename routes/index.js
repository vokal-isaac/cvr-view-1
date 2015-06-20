"use strict";

var express = require( "express" );
var router = express.Router();
var cvr = require( "cvr" );
var mongoose = require( "mongoose" );
var uuid = require( "uuid-lib" );

var auth = require( "../lib/auth" );
var models = require( "../lib/models" );

var dbConn = process.env.DB_CONN || require( "../local-settings.json" ).dbConn;
mongoose.connect( dbConn );

var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function (callback) {
  // yay!
});

var error = function ( req, res, err )
{
    res.render( "error", {
        message: err ? err.message : "Server Error",
        error: err,
        layout: "layout.html",
        authed: req.isAuthenticated()
    });
};

router.get( "/", function( req, res, next )
{
    res.render("index", {
        layout: "layout.html",
        title: "Express",
        authed: req.isAuthenticated() });
} );

router.get( "/repos",
    auth.ensureAuthenticated,
    function( req, res, next )
    {
        var username = req.session.user.profile.username;


        var onActiveRepos = function ( err, user, active )
        {
            if( err )
            {
                return error( req, res, err );
            }

            res.render( "repos", {
                layout: "layout.html",
                title: "Repos",
                repos: user.repos,
                activeRepos: user.activeRepos,
                authed: true } );
        };

        var onUserRepos = function ( err, user )
        {
            user.save( function ( err )
            {
                if( err )
                {
                    return error( req, res, err );
                }

                if( req.query.refresh )
                {
                    return res.redirect( "/repos" );
                }

                var repoFullNames = user.repos.map( function ( r )
                {
                    return r.fullName;
                } );

                models.Repo.findFullNameInArray( repoFullNames, function ( err, activeRepos )
                {
                    if( err )
                    {
                        return error( req, res, err );
                    }

                    user.activeRepos = [];

                    user.repos.forEach( function ( userRepo )
                    {
                        var activeRepo = activeRepos.filter( function ( activeRepo )
                        {
                            return activeRepo.fullName === userRepo.fullName;
                        } );

                        if( activeRepo.length )
                        {
                            if( activeRepo[ 0 ].commits && activeRepo[ 0 ].commits.length )
                            {
                                var lastCoverage = activeRepo[ 0 ].commits[ activeRepo[ 0 ].commits.length - 1 ];
                                userRepo.linePercent = lastCoverage.linePercent.toFixed( 0 );
                            }

                            user.activeRepos.push( userRepo );
                        }
                    } );

                    user.repos = user.repos.filter( function ( userRepo )
                    {
                        return !userRepo.isActive;
                    } );

                    onActiveRepos( null, user );
                } );
            });
        };

        var onUser = function ( err, user )
        {
            if( err )
            {
                return error( req, res, err );
            }

            if( !user )
            {
                user = new models.User({ oauth: {
                    provider: "github",
                    username: username
                }});
            }

            if( user.repos.length && !req.query.refresh )
            {
                onUserRepos( null, user );
            }
            else
            {
                cvr.getGitHubRepos( req.session.user.token, function ( err, repos )
                {
                    if( err )
                    {
                        return error( req, res, err );
                    }

                    user.repos = repos.map( function ( r )
                    {
                        return {
                            owner: r.owner.login,
                            name: r.name,
                            fullName: r.full_name
                        };
                    } );

                    onUserRepos( null, user );
                } );
            }
        };

        models.User.findOne( { "oauth.username": username }, onUser );
    } );

router.get( "/repo/:owner/:name",
    auth.ensureAuthenticated,
    function( req, res, next )
    {
        var onRepo = function ( err, repo )
        {
            if( err )
            {
                return error( req, res, err );
            }

            if( !repo )
            {
                repo = new models.Repo({
                    provider: "github",
                    owner: req.params.owner,
                    name: req.params.name,
                    fullName: req.params.owner + "/" + req.params.name,
                    token: uuid.raw()
                });
                repo.save();
            }

            if( repo.commits.length === 0 )
            {
                return res.render( "commit-activate", {
                    layout: "layout.html",
                    repo: repo,
                    authed: true } );
            }

            var commit = repo.commits[ repo.commits.length - 1 ];
            var coverage = commit.coverage;

            var onCov = function ( err, cov )
            {
                res.render( "commit", {
                    layout: "layout.html",
                    repo: repo,
                    cov: cov,
                    hash: commit.hash,
                    authed: true } );
            };

            cvr.getCoverage( coverage, "lcov", onCov );
        };

        models.Repo.findByOwnerAndName( req.params.owner, req.params.name, onRepo );
    } );

router.get( "/repo/:owner/:name/:hash/:file(*)",
    auth.ensureAuthenticated,
    function( req, res, next )
    {
        var onRepo = function ( err, repo )
        {
            if( err )
            {
                return error( req, res, err );
            }

            var commit = repo.commits.filter( function ( c )
            {
                return c.hash = req.params.hash;
            });

            if( commit.length === 0 )
            {
                return res.status( 404 ).end();
            }

            var shiftLineIndex = function ( lines )
            {
                return lines.map( function ( l )
                {
                    return l - 1;
                } );
            };

            var onCov = function ( err, cov )
            {
                var fileCov = cvr.getFileCoverage( cov, req.params.file );

                var onFileContent = function ( err, content )
                {
                    if( err )
                    {
                        return error( req, res, err );
                    }

                    res.render( "coverage", {
                        layout: "layout.html",
                        repo: repo,
                        cov: cov,
                        hash: req.params.hash,
                        fileName: req.params.file,
                        extension: cvr.getFileType( req.params.file ),
                        linesCovered: shiftLineIndex( cvr.linesCovered( fileCov ) ).join( "," ),
                        linesMissing: shiftLineIndex( cvr.linesMissing( fileCov ) ).join( "," ),
                        source: content,
                        authed: true
                     } );
                };

                cvr.getGitHubFile( req.session.user.token, req.params.owner, req.params.name,
                    req.params.hash, req.params.file, onFileContent );
            };

            cvr.getCoverage( commit[ 0 ].coverage, "lcov", onCov );
        };

        models.Repo.findByOwnerAndName( req.params.owner, req.params.name, onRepo );
    } );

router.post( "/coverage", function( req, res, next )
{
    if( req.body.token && req.body.commit && req.body.coverage )
    {
        var onCoverageSaved = function ( err )
        {
            if( err )
            {
                return res.status( 404 ).send( err.message ).end();
            }

            return res.status( 201 ).end();
        };

        return saveCoverage( req.body.token, req.body.commit,
            req.body.coverage, req.body.coveragetype || "lcov", onCoverageSaved );
    }

    res.status( 400 ).end();
} );

var saveCoverage = function ( token, hash, coverage, coverageType, callback )
{
    var onRepo = function ( err, repo )
    {
        if( err )
        {
            return callback( err );
        }

        if( !repo )
        {
            return callback( new Error( "Token is not registered" ) );
        }

        var commit = repo.commits.filter( function ( c )
        {
            return c.hash == hash;
        } );

        cvr.getCoverage( coverage, coverageType, function ( err, cov )
        {
            var linePercent = cvr.getLineCoveragePercent( cov );

            if( commit.length )
            {
                commit[ 0 ].coverage = coverage;
                commit[ 0 ].linePercent = linePercent
            }
            else
            {
                repo.commits.push( {
                    hash: hash,
                    coverage: coverage,
                    linePercent: linePercent
                } );
            }

            repo.save( callback );
        } );
    };

    models.Repo.findOne( { token: token }, onRepo );
};

module.exports = router;