/** Validates and replaces req[part] with the parsed value. ZodErrors are handled by errorHandler. */
export const validate = (schema, part = 'body') => (req, _res, next) => {
  try {
    const parsed = schema.parse(req[part] ?? {});
    if (part === 'query') {
      // req.query is a getter in Express 5; keep a parsed copy instead of reassigning.
      req.validatedQuery = parsed;
    } else {
      req[part] = parsed;
    }
    next();
  } catch (err) {
    next(err);
  }
};
