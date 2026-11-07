export function validate(schema) {
    return (req, _res, next) => {
        try {
            req.body = schema.parse(req.body);
            next();
        }
        catch (error) {
            next(error);
        }
    };
}
export function validateQuery(schema) {
    return (req, _res, next) => {
        try {
            const parsed = schema.parse(req.query);
            Object.keys(req.query).forEach((key) => delete req.query[key]);
            Object.assign(req.query, parsed);
            next();
        }
        catch (error) {
            next(error);
        }
    };
}
