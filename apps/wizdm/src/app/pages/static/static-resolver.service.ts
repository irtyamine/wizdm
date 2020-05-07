import { Router, Resolve, ActivatedRouteSnapshot, ParamMap } from '@angular/router';
import { SelectorResolver, FileLoader } from '@wizdm/content';
import { map, catchError, switchMap } from 'rxjs/operators';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

export interface StaticContent {
  body: string;
  toc?: any;
  ref?: string;
}

export interface StaticCache {
  lang: string;
  [key:string]: string;
}

@Injectable()
export class StaticResolver implements Resolve<StaticContent> {

  private cache: StaticCache;
  
  constructor(private router: Router, private selector: SelectorResolver, private loader: FileLoader) { }

  /** The default language of the content manager */
  get defaultLang() { return this.selector.config.defaultValue; }

  /** Resolves the content loading the requested source file */
  public resolve(route: ActivatedRouteSnapshot): Observable<StaticContent> {

    // Gets the root path from the route data
    const root = route.data.source || 'assets/docs';
    
    // Resolves the language code from the route using the content selector resolver
    const lang = this.selector.resolve(route);

    // Resolves the source file path from the route
    const path = this.resolvePath(route.paramMap);

    console.log("Static requesting:", root, lang, path);

    // Resets the cache whenever the requested language changes
    // Caching the content results in the following advantages:
    // 1. Skipping http.get() requests for already cached content provided the static module hasn't been reloaded
    // 2. Skipping markdown re-rendering of unchanged content (likely the toc) since the cached string doesn't change
    if(lang !== this.cache?.lang) { this.cache = { lang }; }
    
    // Loads the main .md file
    return this.loader.loadFile(root, lang, path.replace(/\.\w+$/, '') + '.md').pipe(
      // Gets the body contents...
      switchMap( body => {

        // Parses the comments looking for options
        const options = this.parseComments(body);

        // Returns the body plus the options when no toc is found
        if(!options.toc) { return of({ body, path, ...options }); }
        
        // Loads the toc file if any
        return this.loader.loadFile(root, lang, options.toc).pipe( 
          // And returns the body, the toc and the options
          map( toc => ({ body, path, ...options, toc }) 
        ));
      }),
      
      // Redirects to NotFound when no content is found
      catchError( e => {
  
        console.error('Unable to load, edirecting to not-found', e);

        this.router.navigate(['/not-found']); 
        
        return of({ body: '' });
      })
    );
  }

  /** Path resolver helper */
  private resolvePath(params: ParamMap): string {
  
    return params && params.keys
    // Matches all the params starting with 'path'
    .filter( key => !!key.match(/^path\d*$/) )
    // Gets the corresponding values
    .map( key => params.get(key) )
    // Joins the parameters into the full path
    .join('/');
  }

  /** Parses the comments from source md file */
  private parseComments(source): { [key:string]: string } {

    const out = {};

    if(!source) { return out; }

    const comments = /<!--([\s\S]*?)-->/g;
    const pairs = /\s*(\w+):\s*([\w-_.]*)\s*/g;

    this.parse(comments, source, comment => {

      this.parse(pairs, comment[1], pair => {

        out[ pair[1] ] = pair[2];

      });
    });

    return out;
  }

  private parse(rx: RegExp, source: string, fn: (match: RegExpExecArray) => void) {

    if(typeof(fn) !== 'function') { throw new Error("fn must be a function"); }

    let match;
    while( match = rx.exec( source ) ) {

      // Prevents the zero-length match infinite loop for all browsers
      if(match.index == rx.lastIndex) { rx.lastIndex++ };

      fn(match);
    }
  }
}
