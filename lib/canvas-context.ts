const CANVAS_READBACK_PATCH_FLAG = "__bcCanvasReadbackPatched";

type CanvasPrototypeWithPatchFlag = HTMLCanvasElement["prototype"] & {
  [CANVAS_READBACK_PATCH_FLAG]?: boolean;
};

export function ensureCanvasWillReadFrequentlyFor2D(): void {
  if (typeof window === "undefined") {
    return;
  }

  const prototype = HTMLCanvasElement.prototype as CanvasPrototypeWithPatchFlag;

  if (prototype[CANVAS_READBACK_PATCH_FLAG]) {
    return;
  }

  const originalGetContext = prototype.getContext;

  const patchedGetContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: unknown,
  ): RenderingContext | null {
    if (contextId !== "2d") {
      return originalGetContext.call(this, contextId, options as never);
    }

    const incomingSettings =
      options && typeof options === "object"
        ? (options as CanvasRenderingContext2DSettings)
        : undefined;

    const nextSettings: CanvasRenderingContext2DSettings = {
      ...(incomingSettings ?? {}),
      willReadFrequently: incomingSettings?.willReadFrequently ?? true,
    };

    return originalGetContext.call(this, contextId, nextSettings);
  };

  prototype.getContext = patchedGetContext as HTMLCanvasElement["getContext"];
  prototype[CANVAS_READBACK_PATCH_FLAG] = true;
}
