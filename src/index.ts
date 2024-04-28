import type {
  AxiosInstance,
  AxiosResponse,
  CreateAxiosDefaults,
  InternalAxiosRequestConfig,
} from "axios";
import axios from "axios";
import { get } from "lodash";
import {
  BAD_REQUEST_CODE,
  JSON_TYPE,
  JSON_UTF8_TYPE,
  UNAUTHORIZED_CODE,
  UNKNOWN_ERROR,
} from "./constants";

type Req = InternalAxiosRequestConfig;
type Res = AxiosResponse;

type ResFn<V> = (response: Res) => V | Promise<V>;
type ReqFn<V> = (config: Req) => V | Promise<V>;

type ReqFulfilledFn = ((value: Req) => Req | Promise<Req>) | undefined;
type ResFulfilledFn = ((value: Res) => Res | Promise<Res>) | undefined;
type ErrFn = (error: Error) => Promise<unknown>;

type ReqFulfilledFnMiddleWare = <V>(onFulfilled: ReqFn<V>) => ReqFn<V>;
type ResFulfilledFnMiddleWare = <V>(onFulfilled: ResFn<V>) => ResFn<V>;

type Interceptor<M, F, E = ErrFn> = {
  middlewares?: M[];
  onFulfilled?: F;
  onError?: E;
};

type Interceptors = {
  res?: Interceptor<ResFulfilledFnMiddleWare, ResFulfilledFn>;
  req?: Interceptor<ReqFulfilledFnMiddleWare, ReqFulfilledFn>;
};

export class AxiosService {
  public readonly instance: AxiosInstance;
  private requestInterceptors: number | undefined;
  private responseInterceptors: number | undefined;

  constructor({ interceptors, ...config }: CreateAxiosDefaults & { interceptors?: Interceptors }) {
    this.instance = axios.create(config);

    this.handleInterceptors(interceptors);
  }

  setAccessToken(accessToken?: string) {
    this.instance.defaults.headers.common["Authorization"] = accessToken
      ? `Bearer ${accessToken}`
      : null;
  }

  ejectResInterceptor() {
    return () =>
      this.responseInterceptors &&
      this.instance.interceptors.response.eject(this.responseInterceptors);
  }

  ejectReqInterceptor() {
    return () =>
      this.requestInterceptors &&
      this.instance.interceptors.request.eject(this.requestInterceptors);
  }

  /**
   * Private Methods for Interceptors
   */

  private handleInterceptors(interceptors?: Interceptors) {
    if (!interceptors) return;

    const { req, res } = interceptors;

    if (req) {
      const {
        onError: error = (error) => Promise.reject(error),
        onFulfilled: fulfilled = (config) => Promise.resolve(config),
        middlewares,
      } = req;

      if (middlewares) {
        this.requestInterceptors = this.setReqInterceptors(
          middlewares.reduce((acc, middleware) => middleware(acc), fulfilled),
          error
        );
      }
    }

    if (res) {
      const {
        onError: error = (error) => Promise.reject(error),
        onFulfilled: fulfilled = AxiosService.fulfilledResponse,
        middlewares,
      } = res;

      if (middlewares) {
        this.responseInterceptors = this.setResInterceptors(
          middlewares.reduce((acc, middleware) => middleware(acc), fulfilled),
          error
        );
      }
    }
  }

  private setReqInterceptors(
    onFulfilled: ReqFulfilledFn = (config) => Promise.resolve(config),
    onError: ErrFn = (error) => Promise.reject(error)
  ) {
    return this.instance.interceptors.request.use(onFulfilled, onError);
  }

  private setResInterceptors(
    onFulfilled: ResFulfilledFn,
    onError: ErrFn = (error) => Promise.reject(error)
  ) {
    return this.instance.interceptors.response.use(onFulfilled, onError);
  }

  /**
   * Private Static for Middlewares
   */
  private static convertProperty<T>(obj: T) {
    const convert = (obj: T, convertCb: (key: string) => string): T => {
      if (typeof obj !== "object" || obj === null) {
        return obj;
      }

      if (Array.isArray(obj)) {
        return obj.map((item) => convert(item, convertCb)) as T;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newObj: any = {};

      for (const [key, value] of Object.entries(obj)) {
        newObj[convertCb(key)] = convert(value, convertCb);
      }

      return newObj;
    };

    const toCamelCase = (key: string) => key.charAt(0).toLowerCase() + key.slice(1);

    const toPascalCase = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);

    return {
      toCamelCase: () => convert(obj, toCamelCase),
      toPascalCase: () => convert(obj, toPascalCase),
    };
  }

  private static removeProperty<T>(obj: T, removeApiField: (key: string) => boolean): T {
    const remove = (obj: T): T => {
      if (typeof obj !== "object" || obj === null) {
        return obj;
      }

      if (Array.isArray(obj)) {
        return obj.map((item) => remove(item)) as T;
      }

      const newObj: Record<string, T> = {};

      for (const [key, value] of Object.entries(obj)) {
        if (!removeApiField(key)) {
          newObj[key] = remove(value);
        }
      }

      return newObj as T;
    };

    return remove(obj);
  }

  private static fulfilledResponse(response: AxiosResponse) {
    switch (get(response, "headers[content-type]")) {
      case JSON_UTF8_TYPE:
      case JSON_TYPE: {
        if (get(response, "data.statusCode") !== 200) {
          throw new Error(get(response, "data.message", UNKNOWN_ERROR));
        }

        return response;
      }

      default:
        return response;
    }
  }

  /**
   * Public Static Middlewares
   */
  static removeApiFieldMiddleWare: ReqFulfilledFnMiddleWare = (onFulfilled) => {
    const handler = (config: InternalAxiosRequestConfig) => {
      if (config.data instanceof FormData) {
        return config;
      }

      switch (config.method) {
        case "put":
        case "post":
        case "delete":
          return {
            ...config,
            data: this.removeProperty(config.data, (key) => key.startsWith("__")),
          };

        default:
          return config;
      }
    };

    return (config) => onFulfilled(handler(config));
  };

  static convertPascalCaseMiddleWare: ReqFulfilledFnMiddleWare = (onFulfilled) => {
    const handler = (config: InternalAxiosRequestConfig) => {
      if (config.data instanceof FormData) {
        return config;
      }

      switch (config.method) {
        case "put":
        case "post":
        case "delete":
          return { ...config, data: this.convertProperty(config.data).toPascalCase() };

        default:
          return config;
      }
    };

    return (config) => onFulfilled(handler(config));
  };

  static convertCamelCaseMiddleWare: ResFulfilledFnMiddleWare = (onFulfilled) => {
    const handler = (response: AxiosResponse) => {
      switch (response.headers["content-type"]) {
        case JSON_UTF8_TYPE:
        case JSON_TYPE: {
          /**
           * Convert data from Pascal-case to camel-case
           */

          return { ...response, data: this.convertProperty(response.data).toCamelCase() };
        }

        default:
          return response;
      }
    };

    return (response) => onFulfilled(handler(response));
  };

  static async resError(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error: any,
    options?: {
      onUnAuthorized: () => Promise<unknown>;
    }
  ) {
    switch (get(error, "response.status")) {
      case UNAUTHORIZED_CODE:
        return await options?.onUnAuthorized?.();
      case BAD_REQUEST_CODE:
        throw new Error(get(error, "response.data.Message", UNKNOWN_ERROR));
    }
    return Promise.reject(error);
  }
}

export * from "./constants";
