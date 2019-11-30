export default {
    plugins: [
    ],
    input: 'src/ObjectivityCity.js',
    output: [
        {
            format: 'umd',
            name: 'ObjectivityCity',
            file: 'js/ObjectivityCity.js',
            indent: '\t'
        },
        {
            format: 'es',
            file: 'js/ObjectivityCity.module.js',
            indent: '\t'
        }
    ]
};