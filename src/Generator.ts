import * as changeCase from 'change-case';
import dayjs from 'dayjs';
import fs from 'fs-extra';
import path, { dirname } from 'path';
import * as conso from './console';
import _ from 'lodash';
import os from 'os';
import { castArray, cloneDeepFast, dedent, isEmpty, isFunction, noop, pick } from 'vtils';
import {
  CategoryList,
  CommentConfig,
  Config,
  ExtendedInterface,
  Interface,
  InterfaceList,
  Project,
  ProjectConfig,
  ServerConfig,
  SyntheticalConfig,
  GeneratorOptions,
  RequestFunctionTemplateProps
} from './types';
import { exec } from 'child_process';
import {
  getRequestDataJsonSchema,
  getResponseDataJsonSchema,
  jsonSchemaToType,
  formatContent,
  topNotesContent,
  filterHandler
} from './utils';
import { SwaggerToYApiServer } from './SwaggerToYApiServer';
import GenIndex from './genIndex';
import { genJsonSchemeConstContent } from './responseDataJsonSchemaHandler';
import { fetchInterfaceList, fetchProjectInfo, getProjectInfoAndInterfaces } from './requestYapiData';
import { getOutputFilePath } from './getOutputPath';
import GenRequest from './genRequest';

interface OutputFileList {
  [outputFilePath: string]: {
    projectId: string;
    categoryId: string;
    syntheticalConfig: SyntheticalConfig;
    content: string[];
    outputResponseDataJsonSchemaFilePath: string;
    responseDataJsonSchemaContent: string[];
    requestFunctionFilePath: string;
    requestHookMakerFilePath: string;
  };
}

// 默认顶部依赖生成模板
function defaultTopImportPkgTemplate(config?: Config) {
  return `import request from '../request'`;
}

const getDataKeySetStr = (method: string) => {
  if (['head', 'option', 'get'].includes(method.toLowerCase())) {
    return 'params: data';
  }
  return 'data';
};
// 处理路劲参数
function handlePathParam(path: string) {
  if (path.match(/\{(\w+)\}/)) {
    // eslint-disable-next-line no-template-curly-in-string
    return `\`${path.replace(/\{(\w+)\}/g, '${data.$1}')}\``;
  }

  return JSON.stringify(path);
}
// 默认请求函数体生成模板
function defaultRequestFunctionTemplate(props: RequestFunctionTemplateProps, config?: SyntheticalConfig): string {
  const { requestFunctionExtraParams } = config || {};
  const { baseURL, requestFunctionName, requestDataTypeName, responseDataTypeName, extendedInterfaceInfo } = props;
  const { req_params, req_query } = extendedInterfaceInfo;
  const hasData = req_params.length || req_query.length;
  const method = extendedInterfaceInfo.method.toLowerCase();
  let finalBaseUrl = '';
  if (baseURL?.match(/^\[code\]:/)) {
    // 如果使用[code]开头则表示，作为代码段执行，否则仅作为字符串
    finalBaseUrl = baseURL.replace(/^\[code\]:/, '');
  } else {
    finalBaseUrl = `"${baseURL}"`;
  }
  return `export const ${requestFunctionName} = (data${hasData ? '' : '?'}: ${requestDataTypeName}${
    requestFunctionExtraParams ? `,extra?:Record<string,any>` : ''
  }) => {
    return request.${method}<${requestDataTypeName},${responseDataTypeName}>(${handlePathParam(
    extendedInterfaceInfo.path
  )}, {
      ${getDataKeySetStr(method)},
      ${baseURL ? `baseURL: ${finalBaseUrl},` : ''}
      ${requestFunctionExtraParams ? `...extra` : ''}
    })
  }`;
}

// 后台统一网关函数体生成模板
function adminRequestFunctionTemplate(props: RequestFunctionTemplateProps, config?: SyntheticalConfig): string {
  const { baseURL, requestFunctionName, requestDataTypeName, responseDataTypeName, extendedInterfaceInfo } = props;
  const { req_params, req_query } = extendedInterfaceInfo;
  const hasData = req_params.length || req_query.length;
  let finalBaseUrl = '';
  if (baseURL?.match(/^\[code\]:/)) {
    // 如果使用[code]开头则表示，作为代码段执行，否则仅作为字符串
    finalBaseUrl = baseURL.replace(/^\[code\]:/, '');
  } else {
    finalBaseUrl = `"${baseURL}"`;
  }

  const url = config?.proxyInterface?.path || '/proxy';

  return `export const ${requestFunctionName} = (data${hasData ? '' : '?'}: ${requestDataTypeName}) => {
    return request.post<${requestDataTypeName},${responseDataTypeName}>( '${url}', {
      data:{
        real_url: '${extendedInterfaceInfo.path}',
        params: data
      },
      ${baseURL ? `baseURL: ${finalBaseUrl}` : ''}
    })
  }`;
}

export class Generator {
  /** 配置 */
  private config: ServerConfig;

  private disposes: Array<() => any> = [];

  constructor(config: Config, private options: GeneratorOptions = { cwd: process.cwd() }) {
    // config 可能是对象或数组，统一为数组
    this.config = config;
  }

  async prepare(): Promise<void> {
    if (this.config.serverType === 'swagger') {
      const swaggerToYApiServer = new SwaggerToYApiServer({
        swaggerJsonUrl: this.config.serverUrl
      });
      this.config.serverUrl = await swaggerToYApiServer.start();
      this.disposes.push(() => swaggerToYApiServer.stop());
    }
    if (this.config.serverUrl) {
      // 去除地址后面的 /
      this.config.serverUrl = this.config.serverUrl.replace(/\/+$/, '');
    }
  }

  /**
   * 生成代码
   * @returns
   */
  async generate(): Promise<OutputFileList> {
    const outputFileList: OutputFileList = Object.create(null);

    const { projects, serverUrl, serverType, preproccessInterface, outputFilePath, filter } = this.config;
    const projectArray = castArray(projects);

    const projectArrayRender = projectArray.map(async (project, projectIndex) => {
      // const projectInfo = await fetchProjectInfo({
      //   ...this.config,
      //   ...project
      // });

      // // 所有接口列表
      // const allInterfaceList = await fetchInterfaceList({
      //   ...this.config,
      //   ...project
      // });

      const { projectInfo, allInterfaceList } = await getProjectInfoAndInterfaces({
        ...this.config,
        ...project
      });

      // spinnerInstance.stop();

      // 按分类分组
      let categoryInterfaceList: Record<number | string, InterfaceList> = {};

      allInterfaceList.forEach((item, index) => {
        const catId = item._id;
        categoryInterfaceList[catId] = item.list || [];
      });

      const { categories = [] } = project || {};
      if (categories && categories.length) {
        const cids = categories.map(item => item.id);
        categoryInterfaceList = pick(categoryInterfaceList, cids as readonly number[]) || {};
      }

      return Promise.all(
        Object.keys(categoryInterfaceList).map(async (catId: string, catIndex) => {
          const categoryConfig = categories?.filter(cat => String(cat.id) === catId)[0];
          // 接口列表
          let interfaceList = categoryInterfaceList[catId];
          interfaceList = interfaceList
            .map(interfaceInfo => {
              const { path, _id } = interfaceInfo;
              const interfaceFilter = categoryConfig?.filter || filter;
              if (!filterHandler(interfaceFilter)(path, _id)) {
                return false;
              }
              // 实现 _project 字段
              // interfaceInfo._project = omit(projectInfo, ['cats', 'getMockUrl', 'getDevUrl', 'getProdUrl']);
              // 预处理
              const _interfaceInfo = isFunction(preproccessInterface)
                ? preproccessInterface(cloneDeepFast(interfaceInfo), changeCase)
                : interfaceInfo;

              return _interfaceInfo;
            })
            .filter(Boolean) as any;

          const categoryCode: string[] = [];

          const categoryResponseDataJsonSchemaContent: string[] = [];
          const interfaceCodes = await Promise.all(
            interfaceList.map<
              Promise<{
                categoryUID: string;
                outputFilePath: string;
                weights: number[];
                code: string;
                responseDataJsonSchema: string;
              }>
            >(async interfaceInfo => {
              const finalOutputFilePath = path.resolve(
                this.options.cwd,
                // typeof syntheticalConfig.outputFilePath === 'function'
                //   ? syntheticalConfig.outputFilePath(interfaceInfo, changeCase)
                //   : syntheticalConfig.outputFilePath!
                outputFilePath!
              );
              const categoryUID = `${projectIndex}_${catId}_${catIndex}`;
              const { code, responseDataJsonSchema } = await this.generateInterfaceCode(
                {
                  ...this.config,
                  ...project
                },
                interfaceInfo,
                categoryUID
              );
              const weights: number[] = [Number(catId), catIndex];
              categoryCode.push(code);
              categoryResponseDataJsonSchemaContent.push(responseDataJsonSchema);
              return {
                categoryUID,
                outputFilePath: finalOutputFilePath,
                weights,
                code,
                responseDataJsonSchema
              };
            })
          );

          const catOutputFilePath = getOutputFilePath(this.config, `/${projectInfo?._id}/${catId}.ts`);

          if (categoryCode.length > 0) {
            outputFileList[catOutputFilePath] = {
              projectId: String(projectInfo?._id),
              categoryId: catId,
              syntheticalConfig: this.config,
              content: categoryCode,
              outputResponseDataJsonSchemaFilePath: getOutputFilePath(
                this.config,
                `/${projectInfo?._id}/${catId}responseDataJsonSchema.ts`
              ),
              responseDataJsonSchemaContent: categoryResponseDataJsonSchemaContent,
              requestFunctionFilePath: this.config.requestFunctionFilePath
                ? path.resolve(this.options.cwd, this.config.requestFunctionFilePath)
                : path.join(path.dirname(catOutputFilePath), 'request.ts'),
              requestHookMakerFilePath: ''
            };
          }
        })
      );
    });
    await Promise.all(projectArrayRender);
    return outputFileList;
  }

  /**
   * 写入文件
   * @param outputFileList
   * @returns
   */
  async write(outputFileList: OutputFileList) {
    const JsonSchemaContentList: string[] = [];
    const CategoryList: { categoryId: string; projectId: string }[] = [];
    Object.keys(outputFileList).forEach(filePath => {
      const item = outputFileList[filePath];
      JsonSchemaContentList.push(item.responseDataJsonSchemaContent.join('\n'));
      CategoryList.push(pick(item, ['categoryId', 'projectId']));
    });
    const config = this.config || ({} as Config);
    // config.getRequestFunctionName;
    // this.requestFunctionNameGen;

    // 生成 request.ts
    await GenRequest(config);
    // 生成入口 index.ts
    await GenIndex(config, CategoryList);

    return Promise.all(
      Object.keys(outputFileList).map(async outputFilePath => {
        let {
          content,
          requestFunctionFilePath,
          requestHookMakerFilePath,
          syntheticalConfig,
          outputResponseDataJsonSchemaFilePath,
          responseDataJsonSchemaContent
        } = outputFileList[outputFilePath];

        // 支持 .jsx? 后缀
        outputFilePath = outputFilePath.replace(/\.js(x)?$/, '.ts$1');
        requestFunctionFilePath = requestFunctionFilePath.replace(/\.js(x)?$/, '.ts$1');
        requestHookMakerFilePath = requestHookMakerFilePath.replace(/\.js(x)?$/, '.ts$1');

        const topImportPkgTemplate = syntheticalConfig.topImportPkgTemplate || defaultTopImportPkgTemplate;

        // 始终写入主文件
        const rawOutputContent = dedent`
          ${topNotesContent()}
          ${topImportPkgTemplate(config)}

          ${content.join('\n\n').trim()}
        `;

        const outputContent = formatContent(dedent`${rawOutputContent}`, config.prettierConfigPath);
        await fs.outputFile(outputFilePath, outputContent);

        // 如果要生成 JavaScript 代码，
        // 则先对主文件进行 tsc 编译，主文件引用到的其他文件也会被编译，
        // 然后，删除原始的 .tsx? 文件。
        if (syntheticalConfig.target === 'javascript') {
          await this.tsc(outputFilePath);
          await Promise.all([
            fs.remove(requestFunctionFilePath).catch(noop),
            fs.remove(requestHookMakerFilePath).catch(noop),
            fs.remove(outputFilePath).catch(noop)
          ]);
        }
      })
    );
  }

  async tsc(file: string) {
    return new Promise<void>(resolve => {
      // add this to fix bug that not-generator-file-on-window

      const command = `${os.platform() === 'win32' ? 'node ' : ''}${require.resolve(`typescript/bin/tsc`)}`;

      exec(
        `${command} --target ES2019 --module ESNext --jsx preserve --declaration --esModuleInterop ${file}`,
        {
          cwd: this.options.cwd,
          env: process.env
        },
        () => resolve()
      );
    });
  }

  /** 请求函数名生成 */
  requestFunctionNameGen(extendedInterfaceInfo: ExtendedInterface): string {
    const path = extendedInterfaceInfo.parsedPath.dir;
    const method = extendedInterfaceInfo.method; // 可能存在同path，不同method的用法
    const words = [method, ...path.split('/'), extendedInterfaceInfo.parsedPath.name].join('_');
    return changeCase.camelCase(words);
  }

  /** 生成接口代码 */
  async generateInterfaceCode(syntheticalConfig: SyntheticalConfig, interfaceInfo: Interface, categoryUID: string) {
    const extendedInterfaceInfo: ExtendedInterface = {
      ...interfaceInfo,
      parsedPath: path.parse(interfaceInfo.path)
    };
    const requestFunctionName = isFunction(syntheticalConfig.getRequestFunctionName)
      ? await syntheticalConfig.getRequestFunctionName(extendedInterfaceInfo, changeCase)
      : this.requestFunctionNameGen(extendedInterfaceInfo);
    const requestConfigName = changeCase.camelCase(`${requestFunctionName}RequestConfig`);
    const requestConfigTypeName = changeCase.pascalCase(requestConfigName);
    const requestDataTypeName = isFunction(syntheticalConfig.getRequestDataTypeName)
      ? await syntheticalConfig.getRequestDataTypeName(extendedInterfaceInfo, changeCase)
      : changeCase.pascalCase(`${requestFunctionName}Request`);
    const responseDataTypeName = isFunction(syntheticalConfig.getResponseDataTypeName)
      ? await syntheticalConfig.getResponseDataTypeName(extendedInterfaceInfo, changeCase)
      : changeCase.pascalCase(`${requestFunctionName}Response`);
    const requestDataJsonSchema = getRequestDataJsonSchema(extendedInterfaceInfo);
    // 入参

    const requestDataType = await jsonSchemaToType(requestDataJsonSchema, requestDataTypeName);
    const responseDataJsonSchema = getResponseDataJsonSchema(extendedInterfaceInfo, syntheticalConfig.dataKey);
    // console.log(JSON.stringify(responseDataJsonSchema));
    const responseDataType = await jsonSchemaToType(responseDataJsonSchema, responseDataTypeName);
    const isRequestDataOptional = /(\{\}|any)$/s.test(requestDataType);
    const requestHookName =
      syntheticalConfig.reactHooks && syntheticalConfig.reactHooks.enabled
        ? isFunction(syntheticalConfig.reactHooks.getRequestHookName)
          ? /* istanbul ignore next */
            await syntheticalConfig.reactHooks.getRequestHookName(extendedInterfaceInfo, changeCase)
          : `use${changeCase.pascalCase(requestFunctionName)}`
        : '';

    // 支持路径参数
    const paramNames = (extendedInterfaceInfo.req_params /* istanbul ignore next */ || []).map(item => item.name);
    const paramNamesLiteral = JSON.stringify(paramNames);
    const paramNameType = paramNames.length === 0 ? 'string' : `'${paramNames.join("' | '")}'`;

    // 支持查询参数
    const queryNames = (extendedInterfaceInfo.req_query /* istanbul ignore next */ || []).map(item => item.name);
    const queryNamesLiteral = JSON.stringify(queryNames);
    const queryNameType = queryNames.length === 0 ? 'string' : `'${queryNames.join("' | '")}'`;

    // 接口注释
    const genComment = (genTitle: (title: string) => string) => {
      const {
        enabled: isEnabled = true,
        title: hasTitle = true,
        category: hasCategory = true,
        tag: hasTag = true,
        requestHeader: hasRequestHeader = true,
        updateTime: hasUpdateTime = true,
        link: hasLink = true
      } = {
        ...syntheticalConfig.comment,
        // Swagger 时总是禁用标签、更新时间、链接
        ...(syntheticalConfig.serverType === 'swagger'
          ? {
              tag: false,
              updateTime: false,
              link: false
            }
          : {})
      } as CommentConfig;
      if (!isEnabled) {
        return '';
      }
      // 转义标题中的 /
      const escapedTitle = String(extendedInterfaceInfo.title).replace(/\//g, '\\/');
      const description = hasLink
        ? `[${escapedTitle}↗](${syntheticalConfig.serverUrl}/project/${extendedInterfaceInfo.project_id}/interface/api/${extendedInterfaceInfo._id})`
        : escapedTitle;
      const summary: Array<
        | false
        | {
            label: string;
            value: string | string[];
          }
      > = [
        hasCategory && {
          label: '分类',
          value: hasLink
            ? `[${extendedInterfaceInfo._category.name}↗](${syntheticalConfig.serverUrl}/project/${extendedInterfaceInfo.project_id}/interface/api/cat_${extendedInterfaceInfo.catid})`
            : extendedInterfaceInfo._category.name
        },
        hasTag && {
          label: '标签',
          value: extendedInterfaceInfo.tag.map(tag => `\`${tag}\``)
        },
        hasRequestHeader && {
          label: '请求头',
          value: `\`${extendedInterfaceInfo.method.toUpperCase()} ${extendedInterfaceInfo.path}\``
        },
        hasUpdateTime && {
          label: '更新时间',
          value: process.env.JEST_WORKER_ID // 测试时使用 unix 时间戳
            ? String(extendedInterfaceInfo.up_time)
            : /* istanbul ignore next */
              `\`${dayjs(extendedInterfaceInfo.up_time * 1000).format('YYYY-MM-DD HH:mm:ss')}\``
        }
      ];
      const titleComment = hasTitle
        ? dedent`
            * ${genTitle(description)}
            *
          `
        : '';
      const extraComment: string = summary
        .filter(item => typeof item !== 'boolean' && !isEmpty(item.value))
        .map(item => {
          const _item: Exclude<typeof summary[0], boolean> = item as any;
          return `* @${_item.label} ${castArray(_item.value).join(', ')}`;
        })
        .join('\n');
      return dedent`
        /**
         ${[titleComment].filter(Boolean).join('\n')}
         */
      `;
    };
    const requestFunctionTemplate =
      syntheticalConfig.requestFunctionTemplate ||
      (syntheticalConfig.proxyInterface ? adminRequestFunctionTemplate : defaultRequestFunctionTemplate);
    const baseURL = syntheticalConfig.baseURL;
    let baseUrl;
    try {
      baseUrl =
        typeof baseURL === 'string'
          ? baseURL
          : typeof baseURL === 'function'
          ? baseURL(extendedInterfaceInfo.path)
          : '';
    } catch (e) {
      conso.error(e);
    }

    const code = dedent`
      ${genComment(title => `${title} 请求参数`)}
      ${requestDataType.trim()}

      ${genComment(title => `${title} 响应数据`)}
      ${responseDataType.trim()}

      ${
        syntheticalConfig.typesOnly
          ? ''
          : dedent`
            ${genComment(title => `${title}`)}
            ${requestFunctionTemplate(
              {
                baseURL: baseUrl,
                requestFunctionName,
                requestDataTypeName,
                responseDataTypeName,
                extendedInterfaceInfo
              },
              syntheticalConfig
            )}

          `
      }
    `;

    return {
      code,
      responseDataJsonSchema: genJsonSchemeConstContent(
        extendedInterfaceInfo.path,
        syntheticalConfig.serverUrl || '',
        extendedInterfaceInfo,
        responseDataJsonSchema
      )
    };
  }

  async destroy() {
    return Promise.all(this.disposes.map(async dispose => dispose()));
  }
}
