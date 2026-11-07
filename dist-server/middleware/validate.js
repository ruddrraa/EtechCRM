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
            schema.parse(req.query);
            next();
        }
        catch (error) {
            next(error);
        }
    };
}
