import prompts from 'prompts';
import { CookieJar } from 'tough-cookie';
import { FileCookieStore } from 'tough-cookie-file-store';
import {
  fetchApi,
  fetchInterfaceById,
  fetchToken,
  fetchProjectById,
  fetchExportById,
  fetchCatInterfaceById
} from '../src/requestYapiData';
import { CookieStoreFile, DefaultServerUrl } from '../src/constants';
import { clearCookie } from '../src/cookie';
import ora from 'ora';
import simpleGit from 'simple-git';
import fs from 'fs-extra';
import { autoAsyncSplitQueue, defineConfig } from '../src/helpers';
import { yapiUrlParser } from '../src/yapiUrlAnalysis';
import { Config, ProjectConfig } from '../src/types';

const config = defineConfig([
  {
    serverType: 'yapi',
    serverUrl: '',
    projects: [
      {
        // projectId: 279,
        token: '',
        categories: [
          {
            id: 83,
            filter: path => !!path.match('/dtx-prescription-interface/prescription/v1/create')
          },
          {
            id: 5873
          }
        ]
      }
    ],
    outputFilePath: 'src/api'
  }
]);

async function dodo() {
  const res = await yapiUrlParser(config[2]);
  fs.writeJSONSync('./projects.json', res);
  const projects = res.projects as ProjectConfig[];
  console.log(projects);
}

dodo();
