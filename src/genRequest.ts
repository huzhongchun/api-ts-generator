/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import fs from 'fs-extra';
import { dedent } from 'vtils';
import { Config } from './types';
import { getOutputFilePath } from './getOutputPath';
import { formatContent, topNotesContent } from './utils';
import * as conso from './console';

export default async (config: Config) => {
  const { prettierConfigPath, outputFilePath } = config;
  const rawRequestFunctionFilePath = getOutputFilePath(config, 'request.ts');
  if (!config.typesOnly) {
    if (await fs.pathExists(rawRequestFunctionFilePath)) {
      // conso.tips(`输出目录${outputFilePath}下检测到已有request.ts，如果需要重新生成，请删除该文件 \n`);
      return;
    }
  }

  const content = `
  ${topNotesContent()}

  import request,{ AxiosRequestConfig } from 'axios';  // axios版本>=0.18.1

  const instance = request.create({
    withCredentials: true,
    baseURL: process.env.BASE_URL,
  });

  // 自定义request拦截器
  instance.interceptors.request.use((config) => {
    return  {
      ...config
    }
  });

  // 自定义response拦截器，
  // 注意：如果修改接口正常返回的结构，对应的response声明需要修改
  instance.interceptors.response.use((r) => {
    const { data, config } = r;
    if (data.code === 0) {

      return data.data;
    }
    return Promise.reject(data);
  });

  export default {
    get: <RQ, RP>(url: string, config?: AxiosRequestConfig) => {
      return instance.get<RP>(url, config);
    },
    post: <RQ, RP>(url: string, config?: AxiosRequestConfig) => {
      return instance.post<RP>(url, config);
    }
  };
`;

  fs.outputFile(rawRequestFunctionFilePath, formatContent(dedent`${content}`, prettierConfigPath));
};
